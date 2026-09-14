/**
 * Express 入口。见 02 文档第十三节部署硬约束:
 * - X-Accel-Buffering: no(避免反向代理缓冲导致流式失效)
 * - 不对流式路由开 gzip
 * - Content-Type: application/x-ndjson,不设 Content-Length
 * - 连接建立立即发 start 事件
 */

import express, { type Request, type Response } from 'express';
import cors from 'cors';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from './config.js';
import { logger, maskSecret } from './core/logger.js';
import { checkRateLimit } from './core/ratelimit.js';
import { getMetrics } from './core/metrics.js';
import { getSearchQuotaTracker } from './core/quota.js';
import { createNdjsonWriter } from './core/stream.js';
import { dispatchExplain, dispatchFollowUp, dispatchZhida } from './dispatcher.js';
import { getSession } from './core/session.js';
import { getRingDetail, publishPin, createComment, react } from './modules/community/index.js';
import {
  isOAuthConfigured,
  createOAuthState,
  consumeOAuthState,
  buildAuthorizeUrl,
  exchangeCode,
  fetchUser,
  getOAuthSession,
  attachOAuthUser,
} from './modules/oauth.js';
import type { ExplainRequest } from './types.js';
import { createAdminRouter } from './admin/index.js';

const app = express();

// CORS 白名单(见 B2):Demo 域名(YW_ALLOWED_ORIGINS,逗号分隔)+ chrome-extension:// + localhost。
// 这个接口消耗 LLM 和搜索额度,公网部署前必须收紧,不能让任何站点的页面白嫖。
app.use(
  cors({
    origin(origin, callback) {
      // 无 Origin(服务端到服务端调用、curl、健康检查)放行——CORS 本来就只管浏览器场景
      if (!origin) return callback(null, true);
      if (origin.startsWith('chrome-extension://')) return callback(null, true);
      if (/^https?:\/\/localhost(:\d+)?$/.test(origin) || /^https?:\/\/127\.0\.0\.1(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      // 插件 content script 直连场景:放行知乎各域(www / zhuanlan / 任意子域)。
      // Origin 由浏览器按真实页面源填写、无法伪造,只有真正跑在 zhihu 页面里的 JS
      // 才能带上该 Origin;配合 rate limit 兜底,白嫖风险可控。
      if (/^https?:\/\/([a-z0-9-]+\.)*zhihu\.com$/.test(origin)) return callback(null, true);
      if (config.cors.allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`origin not allowed: ${origin}`));
    },
  })
);
app.use(express.json({ limit: '256kb' }));
// 开发期网页 Demo 静态托管。仅本地/演示用途,删掉这一行不影响任何 API 路由——
// 前端此时需要自行起一个静态服务器(如 `npx serve frontend/web`)。
app.use(express.static('frontend/web'));
// 浏览器只能跑编译后的 .js(NodeNext 模块解析下 .ts 源码不是合法可执行 JS),
// `npm run build:frontend`(dev/start 前会自动跑一次)把 frontend/src/**/*.ts
// 编译到 frontend/dist,这里原样托管,不做打包,继续保持"浏览器原生 ESM"路线。
app.use('/src', express.static('frontend/dist'));

// requestSeq 防串台的服务端配合:每个 sessionId/连接对应的最新 seq 由客户端自己维护并携带,
// 服务端不需要额外状态——AbortController 取消依赖客户端主动断开连接(见 02 文档 5.1)。
let globalSeqCounter = 0;

function getClientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.length > 0) return xff.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

function validateExplainRequest(body: unknown): ExplainRequest | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Partial<ExplainRequest>;
  if (!b.target || typeof b.target.text !== 'string') return null;
  const text = b.target.text.trim();
  if (text.length < 4 || text.length > 500) return null; // 见 02 文档 5.2 长度门槛
  if (!Array.isArray(b.surroundings)) return null;
  if (!b.scope || typeof b.scope.kind !== 'string' || typeof b.scope.id !== 'string') return null;
  if (!b.anchor || typeof b.anchor.exact !== 'string') return null;
  return b as ExplainRequest;
}

function setStreamHeaders(res: Response) {
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('X-Accel-Buffering', 'no'); // 避免反向代理缓冲
  res.setHeader('Cache-Control', 'no-cache');
  res.removeHeader('Content-Length');
  // 关掉这条路由的压缩,压缩会重新引入缓冲(项目未全局启用 compression 中间件,此处仅为文档留痕)
}

app.post('/api/v1/explain', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    getMetrics().recordRateLimit();
    res.status(429).json({ error: 'rate_limited' });
    return;
  }

  const parsed = validateExplainRequest(req.body);
  if (!parsed) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }

  setStreamHeaders(res);
  res.flushHeaders?.();

  const writer = createNdjsonWriter(res);
  const seq = ++globalSeqCounter;

  req.on('close', () => {
    // 客户端断开(用户划了新选区触发 AbortController.abort()),后续 write 静默失败即可,
    // 不需要额外清理——dispatchExplain 内部没有需要显式取消的长驻资源。
  });

  try {
    await dispatchExplain(parsed, {
      seq,
      onEvent: (event) => writer.write(event),
    });
  } catch (err) {
    logger.error('explain_dispatch_failed', { err: String(err) });
    getMetrics().recordError('explain_dispatch_failed', String(err));
    writer.write({ t: 'error', stage: 'body', msg: 'internal error', fatal: true });
  } finally {
    writer.end();
  }
});

app.post('/api/v1/explain/:sessionId/reangle', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    getMetrics().recordRateLimit();
    res.status(429).json({ error: 'rate_limited' });
    return;
  }

  const session = getSession(req.params.sessionId!);
  if (!session) {
    res.status(404).json({ error: 'session_not_found_or_expired' });
    return;
  }

  setStreamHeaders(res);
  res.flushHeaders?.();
  const writer = createNdjsonWriter(res);
  const seq = ++globalSeqCounter;

  try {
    await dispatchExplain(session.request, {
      seq,
      onEvent: (event) => writer.write(event),
      reuseSessionId: session.sessionId,
      reangleOnly: true,
    });
  } catch (err) {
    logger.error('reangle_dispatch_failed', { err: String(err) });
    getMetrics().recordError('reangle_dispatch_failed', String(err));
    writer.write({ t: 'error', stage: 'body', msg: 'internal error', fatal: true });
  } finally {
    writer.end();
  }
});

app.post('/api/v1/followup', async (req: Request, res: Response) => {
  const ip = getClientIp(req);
  if (!checkRateLimit(ip)) {
    getMetrics().recordRateLimit();
    res.status(429).json({ error: 'rate_limited' });
    return;
  }

  const { sessionId, message } = req.body ?? {};
  if (typeof sessionId !== 'string' || !sessionId) {
    res.status(400).json({ error: 'invalid_request', detail: 'sessionId required' });
    return;
  }
  if (typeof message !== 'string' || message.trim().length === 0 || message.length > 500) {
    res.status(400).json({ error: 'invalid_request', detail: 'message required, max 500 chars' });
    return;
  }

  // 存在性检查必须在 setStreamHeaders/flushHeaders 之前:一旦发过响应头,
  // res.headersSent 恒为 true,下面 dispatchFollowUp 返回 false 时就没法再回 404,
  // 客户端只会收到 200 + 空 body,气泡永久停在「正在生成…」(见 B1)。
  if (!getSession(sessionId)) {
    res.status(404).json({ error: 'session_not_found_or_expired' });
    return;
  }

  setStreamHeaders(res);
  res.flushHeaders?.();
  const writer = createNdjsonWriter(res);
  const seq = ++globalSeqCounter;

  try {
    const ok = await dispatchFollowUp({ seq, sessionId, message, onEvent: (event) => writer.write(event) });
    if (!ok) {
      // 上面检查过 session 存在,这里仍拿到 false 只可能是极窄的竞态
      // (TTL 清理定时器恰好在检查之后、dispatch 之前把它扫掉了)。
      // 此时响应头已经发出,不能再回 404,改为在流内发一个 fatal error 帧再结束,
      // 不能让客户端收到 200 + 空 body。
      writer.write({ t: 'error', stage: 'body', msg: 'session_expired', fatal: true });
      return;
    }
  } catch (err) {
    logger.error('followup_dispatch_failed', { err: String(err) });
    getMetrics().recordError('followup_dispatch_failed', String(err));
    writer.write({ t: 'error', stage: 'body', msg: 'internal error', fatal: true });
  } finally {
    writer.end();
  }
});

// 「换个角度·深挖」:走知乎直答。config.features.zhida 关闭时直接 404,赛后一键禁用。
app.post('/api/v1/explain/:sessionId/zhida', async (req: Request, res: Response) => {
  if (!config.features.zhida) {
    res.status(404).json({ error: 'zhida_disabled' });
    return;
  }
  const session = getSession(req.params.sessionId!);
  if (!session) {
    res.status(404).json({ error: 'session_not_found_or_expired' });
    return;
  }

  setStreamHeaders(res);
  res.flushHeaders?.();
  const writer = createNdjsonWriter(res);
  const seq = ++globalSeqCounter;

  try {
    const ok = await dispatchZhida({ seq, sessionId: session.sessionId, onEvent: (event) => writer.write(event) });
    if (!ok) {
      writer.write({ t: 'error', stage: 'body', msg: 'session_expired', fatal: true });
      return;
    }
  } catch (err) {
    logger.error('zhida_dispatch_failed', { err: String(err) });
    getMetrics().recordError('zhida_dispatch_failed', String(err));
    writer.write({ t: 'error', stage: 'body', msg: 'internal error', fatal: true });
  } finally {
    writer.end();
  }
});

// 社区 API(moltbook)路由。config.features.community 默认关,赛后也保持关闭(防误发)。
// 打开需同时配 ZHIHU_COMMUNITY_APP_KEY / APP_SECRET。真实发帖端到端验证「待部署后验证」。
function communityDisabled(res: Response): boolean {
  if (config.features.community) return false;
  res.status(404).json({ error: 'community_disabled' });
  return true;
}

app.get('/api/v1/community/ring/:ringId', async (req: Request, res: Response) => {
  if (communityDisabled(res)) return;
  try {
    const r = await getRingDetail(req.params.ringId!);
    res.json(r);
  } catch (err) {
    logger.error('community_ring_failed', { err: String(err) });
    getMetrics().recordError('community_ring_failed', String(err));
    res.status(502).json({ error: 'upstream_failed' });
  }
});

app.post('/api/v1/community/pin', async (req: Request, res: Response) => {
  if (communityDisabled(res)) return;
  const { ringId, content, title } = req.body ?? {};
  if (typeof ringId !== 'string' || typeof content !== 'string' || content.trim() === '') {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  try {
    const r = await publishPin(ringId, content, typeof title === 'string' ? title : '');
    res.json(r);
  } catch (err) {
    logger.error('community_pin_failed', { err: String(err) });
    getMetrics().recordError('community_pin_failed', String(err));
    res.status(502).json({ error: 'upstream_failed' });
  }
});

app.post('/api/v1/community/comment', async (req: Request, res: Response) => {
  if (communityDisabled(res)) return;
  const { contentToken, contentType, content } = req.body ?? {};
  if (typeof contentToken !== 'string' || typeof content !== 'string' || (contentType !== 'pin' && contentType !== 'comment')) {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  try {
    const r = await createComment(contentToken, contentType, content);
    res.json(r);
  } catch (err) {
    logger.error('community_comment_failed', { err: String(err) });
    getMetrics().recordError('community_comment_failed', String(err));
    res.status(502).json({ error: 'upstream_failed' });
  }
});

app.post('/api/v1/community/reaction', async (req: Request, res: Response) => {
  if (communityDisabled(res)) return;
  const { contentToken, contentType, like } = req.body ?? {};
  if (typeof contentToken !== 'string' || (contentType !== 'pin' && contentType !== 'comment') || typeof like !== 'boolean') {
    res.status(400).json({ error: 'invalid_request' });
    return;
  }
  try {
    const r = await react(contentToken, contentType, like);
    res.json(r);
  } catch (err) {
    logger.error('community_reaction_failed', { err: String(err) });
    getMetrics().recordError('community_reaction_failed', String(err));
    res.status(502).json({ error: 'upstream_failed' });
  }
});

// OAuth 登录。回调地址必须 HTTPS 公网(06 文档 3.2)——代码写好,真实登录「待部署后验证」。
// App ID/Key 已申报但未配 .env,login 路由返回明确提示而非崩溃(「待用户提供」)。

app.get('/auth/zhihu/login', (_req: Request, res: Response) => {
  if (!config.features.oauth) {
    res.status(404).json({ error: 'oauth_disabled' });
    return;
  }
  if (!isOAuthConfigured()) {
    res.status(503).json({ error: 'oauth_not_configured', detail: 'OAuth App ID/Key/回调地址待用户提供' });
    return;
  }
  const state = createOAuthState();
  res.redirect(buildAuthorizeUrl(state));
});

app.get('/auth/zhihu/callback', async (req: Request, res: Response) => {
  const state = String(req.query.state ?? '');
  // 06 文档第六节:回调参数名是 authorization_code,但 token 接口字段叫 code,这里两者都收
  const code = String(req.query.authorization_code ?? req.query.code ?? '');

  if (!consumeOAuthState(state)) {
    res.status(400).json({ error: 'invalid_state' });
    return;
  }
  if (!code) {
    res.status(400).json({ error: 'missing_code' });
    return;
  }

  try {
    const { sessionId } = await exchangeCode(code);
    const session = getOAuthSession(sessionId);
    if (!session) throw new Error('oauth session lost after exchange');
    const user = await fetchUser(session.accessToken);
    attachOAuthUser(sessionId, user);
    res.json({ ok: true, sessionId, user });
  } catch (err) {
    logger.error('oauth_callback_failed', { err: String(err) });
    getMetrics().recordError('oauth_callback_failed', String(err));
    res.status(502).json({ error: 'oauth_exchange_failed' });
  }
});

app.get('/api/v1/me', async (req: Request, res: Response) => {
  const sessionId = String(req.query.session_id ?? '');
  const session = getOAuthSession(sessionId);
  if (!session) {
    res.status(404).json({ error: 'not_logged_in' });
    return;
  }
  try {
    const user = session.user ?? (await fetchUser(session.accessToken));
    attachOAuthUser(sessionId, user);
    res.json({ user });
  } catch (err) {
    logger.error('oauth_me_failed', { err: String(err) });
    getMetrics().recordError('oauth_me_failed', String(err));
    res.status(502).json({ error: 'upstream_failed' });
  }
});

app.get('/api/v1/config', (_req: Request, res: Response) => {
  res.json({
    mock: config.mock,
    angles: ['term', 'subtext', 'hotspot', 'community'],
    searchQuotaRemaining: config.mock ? null : getSearchQuotaTracker().getRemaining(),
  });
});

app.get('/api/v1/health', (_req: Request, res: Response) => {
  res.json({ ok: true, mock: config.mock, requestId: randomUUID() });
});

// 管理后台页面(自包含 HTML)。页面本身不鉴权——token 由页面输入框收集后带在 header 上,
// 鉴权在下面的 admin API 路由里做。注册在 API 路由之前,避免 /admin 被 requireAdmin 拦截。
app.get('/admin', (_req: Request, res: Response) => {
  res.sendFile(path.join(process.cwd(), 'frontend', 'admin', 'index.html'));
});

// 管理后台 API。鉴权见 backend/admin/index.ts 的 requireAdmin(ADMIN_TOKEN header 校验)。
app.use('/admin', createAdminRouter());

async function bootstrap() {
  if (!config.mock) {
    const tracker = getSearchQuotaTracker(async () => {
      // 真实 quota 校准函数,启动时调用一次。失败不阻塞启动。
      try {
        const res = await fetch('https://developer.zhihu.com/api/v1/quota?APIIDs=zhihu_search', {
          headers: {
            Authorization: `Bearer ${config.zhihu.accessSecret}`,
            'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
          },
        });
        if (!res.ok) return null;
        const data = (await res.json()) as { Data?: Array<{ RemainingQuota: number }> };
        return data.Data?.[0]?.RemainingQuota ?? null;
      } catch {
        return null;
      }
    });
    await tracker.calibrate();
  }

  app.listen(config.port, config.host, () => {
    logger.info('server_started', {
      port: config.port,
      mock: config.mock,
      devCapture: config.devCapture,
      deepseekConfigured: config.deepseek.apiKey.length > 0,
      zhihuSecretMasked: maskSecret(config.zhihu.accessSecret),
    });
  });
}

bootstrap().catch((err) => {
  logger.error('bootstrap_failed', { err: String(err) });
  getMetrics().recordError('bootstrap_failed', String(err));
  process.exit(1);
});
