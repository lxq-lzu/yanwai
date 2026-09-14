/**
 * 知乎 OAuth 登录(授权码流程)。见 06 文档第三节 + 07 文档第五节。
 *
 * 安全要点:
 * - state CSRF 防护:授权前生成密码学安全随机 state,回调校验完全一致 + 未过期 + 一次性消费。
 * - App Key 只在后端换 token,不进前端/日志。
 * - access_token 只存 Node 进程内存 Map(不落盘),过期后引导用户重新授权(无 refresh_token)。
 *
 * 回调地址必须 HTTPS 公网——代码已写好,真实登录「待部署后验证」。App ID/Key 已申报,
 * 值未配在 .env 时视为「待用户提供」,login 路由会返回明确提示而非崩溃。
 */

import { randomBytes } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { logger } from '../core/logger.js';
import { getMetrics } from '../core/metrics.js';

// ---------------------------------------------------------------------------
// state(CSRF)存储:纯内存,短 TTL
// ---------------------------------------------------------------------------

const STATE_TTL_MS = 10 * 60 * 1000; // 10 分钟

const pendingStates = new Map<string, number>(); // state -> createdAt

function sweepExpiredStates(now: number) {
  for (const [s, at] of pendingStates) {
    if (now - at > STATE_TTL_MS) pendingStates.delete(s);
  }
}

/** 生成一次授权用的随机 state,存入内存待校验 */
export function createOAuthState(): string {
  const state = randomBytes(32).toString('hex');
  pendingStates.set(state, Date.now());
  return state;
}

/** 校验并一次性消费 state。匹配且未过期返回 true,否则 false。 */
export function consumeOAuthState(state: string): boolean {
  sweepExpiredStates(Date.now());
  const at = pendingStates.get(state);
  if (at === undefined) return false;
  pendingStates.delete(state); // 原子消费,防重复回调复用
  return Date.now() - at <= STATE_TTL_MS;
}

// ---------------------------------------------------------------------------
// token 会话存储:纯内存,不落盘(见 02 文档 7.3「OAuth 会话」)
// ---------------------------------------------------------------------------

export interface OAuthUser {
  uid?: string | number;
  fullname?: string;
  gender?: number;
  headline?: string;
  description?: string;
  avatar_path?: string;
  email?: string;
  phone_no?: string;
}

interface OAuthSession {
  sessionId: string;
  accessToken: string;
  expiresAt: number;
  user?: OAuthUser;
}

const oauthSessions = new Map<string, OAuthSession>(); // sessionId -> session

function storeToken(accessToken: string, expiresIn: number): string {
  const sessionId = randomUUID();
  oauthSessions.set(sessionId, {
    sessionId,
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  });
  return sessionId;
}

export function getOAuthSession(sessionId: string): OAuthSession | undefined {
  const s = oauthSessions.get(sessionId);
  if (!s) return undefined;
  if (Date.now() > s.expiresAt) {
    oauthSessions.delete(sessionId);
    return undefined;
  }
  return s;
}

export function attachOAuthUser(sessionId: string, user: OAuthUser): void {
  const s = oauthSessions.get(sessionId);
  if (s) s.user = user;
}

// ---------------------------------------------------------------------------
// 流程函数
// ---------------------------------------------------------------------------

/** OAuth 凭证是否就绪。App ID/Key/回调地址未配时为 false(「待用户提供」)。 */
export function isOAuthConfigured(): boolean {
  return (
    config.features.oauth &&
    config.zhihu.oauthAppId.length > 0 &&
    config.zhihu.oauthAppKey.length > 0 &&
    config.zhihu.oauthRedirectUri.length > 0
  );
}

/** 构造授权 URL:跳转 openapi.zhihu.com/authorize,带 state */
export function buildAuthorizeUrl(state: string): string {
  const url = new URL('/authorize', config.zhihu.oauthApiBase);
  url.searchParams.set('redirect_uri', config.zhihu.oauthRedirectUri);
  url.searchParams.set('app_id', config.zhihu.oauthAppId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  return url.toString();
}

/**
 * 用授权码换 access_token。POST /access_token,表单 app_id/app_key/grant_type/redirect_uri/code。
 * 注意 06 文档第六节:回调参数名是 authorization_code,但 token 接口字段叫 code,这里由调用方统一成 code。
 */
export async function exchangeCode(code: string): Promise<{ sessionId: string; expiresIn: number }> {
  getMetrics().incr('api:oauth');
  const res = await fetch(new URL('/access_token', config.zhihu.oauthApiBase), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      app_id: config.zhihu.oauthAppId,
      app_key: config.zhihu.oauthAppKey,
      grant_type: 'authorization_code',
      redirect_uri: config.zhihu.oauthRedirectUri,
      code,
    }).toString(),
  });
  if (!res.ok) throw new Error(`oauth access_token http ${res.status}`);

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    throw new Error('oauth access_token exchange failed: no access_token');
  }
  const expiresIn = data.expires_in ?? 2592000; // 默认 30 天,读响应动态判断(06 文档 3.2)
  return { sessionId: storeToken(data.access_token, expiresIn), expiresIn };
}

/**
 * 获取授权用户信息。GET /user,Authorization: Bearer {access_token}。
 * ⚠️ 历史坑:错误时返回 HTTP 200,用响应体 code 字段判断(401/403/404),不是 HTTP 状态码(07 文档 5.6)。
 */
export async function fetchUser(accessToken: string): Promise<OAuthUser> {
  getMetrics().incr('api:oauth');
  const res = await fetch(new URL('/user', config.zhihu.oauthApiBase), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = (await res.json()) as OAuthUser & { code?: number };
  if (typeof data.code === 'number' && data.code !== 0 && data.code !== 200) {
    throw new Error(`oauth user code ${data.code}`);
  }
  logger.info('oauth_user_fetched', { uid: data.uid });
  return data;
}
