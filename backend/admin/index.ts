/**
 * 管理后台路由。四块:① 模块开关 ② 可变配置 ③ 使用数据 ④ 存储管理。
 *
 * 安全:所有 admin 路由走 requireAdmin 鉴权(环境变量 ADMIN_TOKEN + X-Admin-Token
 * header 校验),不裸奔公网;所有密钥只回显后四位,不返回明文。
 *
 * 依赖边界:只读写 config.features / metrics / cache / storage / session,不反向耦合
 * 主链路(frontend/src / dispatcher 等)。见 STATUS 文档 T5。
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { config } from '../config.js';
import { getMetrics } from '../core/metrics.js';
import { getSearchQuotaTracker } from '../core/quota.js';
import { getResultCache, listDevCapture, getDevCaptureCount, clearDevCapture } from '../core/cache.js';
import { getSessionCount, clearAllSessions } from '../core/session.js';

// ---------------------------------------------------------------------------
// 鉴权
// ---------------------------------------------------------------------------

/** ADMIN_TOKEN 未配置(空串)时 503 拒绝,避免公网裸奔;配置后校验 X-Admin-Token header。 */
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const token = config.adminToken;
  if (!token) {
    res.status(503).json({ error: 'admin_not_configured', detail: '设置 ADMIN_TOKEN 环境变量后再访问管理后台' });
    return;
  }
  const header = req.headers['x-admin-token'];
  if (typeof header !== 'string' || header.length === 0 || header !== token) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// ① 模块开关
// ---------------------------------------------------------------------------

const FEATURE_KEYS = ['zhihuSearch', 'hotList', 'globalSearch', 'zhida', 'community', 'oauth'] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

function isFeatureKey(k: string): k is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(k);
}

export interface FeaturePatchResult {
  ok: boolean;
  error?: string;
  changed?: Partial<Record<FeatureKey, boolean>>;
  features?: Record<FeatureKey, boolean>;
}

/** 校验并应用一次模块开关 patch。纯函数(副作用 = 写 config.features),便于单测。 */
export function applyFeaturePatch(body: unknown): FeaturePatchResult {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, error: 'body 必须是 { key: boolean } 对象' };
  }
  const changed: Partial<Record<FeatureKey, boolean>> = {};
  for (const [k, v] of Object.entries(body)) {
    if (!isFeatureKey(k)) return { ok: false, error: `未知开关: ${k}` };
    if (typeof v !== 'boolean') return { ok: false, error: `${k} 必须是 boolean` };
    config.features[k] = v;
    changed[k] = v;
  }
  return { ok: true, changed, features: { ...config.features } };
}

// ---------------------------------------------------------------------------
// ② 可变配置(密钥脱敏)
// ---------------------------------------------------------------------------

/** 只回显密钥后四位,绝不明文返回。空串返回 '(未配置)'。 */
export function maskSecretTail(secret: string): string {
  if (!secret) return '(未配置)';
  if (secret.length <= 4) return '****';
  return `****${secret.slice(-4)}`;
}

/** 可变配置字段(非密钥),映射到 config 的可变字段。密钥只读脱敏展示,不在此表。 */
const MUTABLE_CONFIG_KEYS = [
  'deepseek.model',
  'zhihu.zhidaModel',
  'searchQuota.dailyBudget',
  'cache.ttlStableMs',
  'cache.ttlTimeSensitiveMs',
  'session.ttlMs',
  'rateLimit.perIpDaily',
] as const;
type MutableConfigKey = (typeof MUTABLE_CONFIG_KEYS)[number];

const STRING_CONFIG_KEYS: readonly MutableConfigKey[] = ['deepseek.model', 'zhihu.zhidaModel'];

export function readMutableConfig(): Record<MutableConfigKey, number | string> {
  return {
    'deepseek.model': config.deepseek.model,
    'zhihu.zhidaModel': config.zhihu.zhidaModel,
    'searchQuota.dailyBudget': config.searchQuota.dailyBudget,
    'cache.ttlStableMs': config.cache.ttlStableMs,
    'cache.ttlTimeSensitiveMs': config.cache.ttlTimeSensitiveMs,
    'session.ttlMs': config.session.ttlMs,
    'rateLimit.perIpDaily': config.rateLimit.perIpDaily,
  };
}

/** 写可变配置字段。字符串字段校验非空,数字字段校验为正数;通过后写 config 对应字段。 */
export function writeMutableConfig(key: MutableConfigKey, value: number | string): { ok: boolean; error?: string } {
  if (STRING_CONFIG_KEYS.includes(key)) {
    if (typeof value !== 'string' || value.trim() === '') {
      return { ok: false, error: `${key} 必须是非空字符串` };
    }
  } else if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return { ok: false, error: `${key} 必须是正数` };
  }

  switch (key) {
    case 'deepseek.model':
      config.deepseek.model = value as string;
      break;
    case 'zhihu.zhidaModel':
      config.zhihu.zhidaModel = value as string;
      break;
    case 'searchQuota.dailyBudget':
      config.searchQuota.dailyBudget = value as number;
      break;
    case 'cache.ttlStableMs':
      config.cache.ttlStableMs = value as number;
      break;
    case 'cache.ttlTimeSensitiveMs':
      config.cache.ttlTimeSensitiveMs = value as number;
      break;
    case 'session.ttlMs':
      config.session.ttlMs = value as number;
      break;
    case 'rateLimit.perIpDaily':
      config.rateLimit.perIpDaily = value as number;
      break;
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 路由装配
// ---------------------------------------------------------------------------

export function createAdminRouter(): Router {
  const router = Router();
  router.use(requireAdmin);

  // ① 模块开关:GET 读 / POST 切
  router.get('/features', (_req, res) => {
    res.json({ features: { ...config.features } });
  });

  router.post('/features', (req, res) => {
    const result = applyFeaturePatch(req.body);
    if (!result.ok) {
      res.status(400).json({ error: result.error });
      return;
    }
    res.json({ ok: true, changed: result.changed, features: result.features });
  });

  // ② 可变配置:GET 展示(密钥脱敏)/ POST 修改(白名单字段)
  router.get('/config', (_req, res) => {
    res.json({
      mutable: readMutableConfig(),
      secrets: {
        deepseekApiKey: maskSecretTail(config.deepseek.apiKey),
        zhihuAccessSecret: maskSecretTail(config.zhihu.accessSecret),
        zhihuOauthAppKey: maskSecretTail(config.zhihu.oauthAppKey),
        zhihuCommunityAppKey: maskSecretTail(config.zhihu.communityAppKey),
        zhihuCommunityAppSecret: maskSecretTail(config.zhihu.communityAppSecret),
      },
      flags: {
        mock: config.mock,
        devCapture: config.devCapture,
        storageMode: config.storage.mode,
      },
    });
  });

  router.post('/config', (req, res) => {
    const body = req.body;
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      res.status(400).json({ error: 'invalid_request', detail: 'body 必须是 { key: value } 对象' });
      return;
    }
    const changed: Partial<Record<MutableConfigKey, number | string>> = {};
    for (const [k, v] of Object.entries(body)) {
      if (!(MUTABLE_CONFIG_KEYS as readonly string[]).includes(k)) {
        res.status(400).json({ error: 'unknown_config_key', detail: `不可修改字段: ${k}` });
        return;
      }
      const key = k as MutableConfigKey;
      const result = writeMutableConfig(key, v as number | string);
      if (!result.ok) {
        res.status(400).json({ error: 'invalid_value', detail: result.error });
        return;
      }
      changed[key] = v as number | string;
    }
    res.json({ ok: true, changed, mutable: readMutableConfig() });
  });

  // ③ 使用数据:总调用 / 各 API 调用量 / 缓存命中率 / 额度剩余 / 限流触发次数
  router.get('/usage', (_req, res) => {
    const snap = getMetrics().snapshot();
    const c = snap.counters;
    res.json({
      startedAt: snap.startedAt,
      calls: {
        explain: c['explain'] ?? 0,
        followup: c['followup'] ?? 0,
        reangle: c['reangle'] ?? 0,
        zhida: c['zhida'] ?? 0,
        total: (c['explain'] ?? 0) + (c['followup'] ?? 0) + (c['reangle'] ?? 0) + (c['zhida'] ?? 0),
      },
      apis: {
        zhihuSearch: c['api:zhihu_search'] ?? 0,
        hotList: c['api:hot_list'] ?? 0,
        globalSearch: c['api:global_search'] ?? 0,
        zhida: c['api:zhida'] ?? 0,
        community: c['api:community'] ?? 0,
        oauth: c['api:oauth'] ?? 0,
      },
      cache: snap.cache,
      rateLimited: snap.rateLimited,
      quotaRemaining: config.mock ? null : getSearchQuotaTracker().getRemaining(),
    });
  });

  // ⑤ 运行错误:最近错误列表(时间/类型/消息)+ 按类型计数
  router.get('/errors', (_req, res) => {
    const errors = getMetrics().recentErrors();
    const byType: Record<string, number> = {};
    for (const e of errors) byType[e.type] = (byType[e.type] ?? 0) + 1;
    res.json({ errors, byType });
  });

  // ④ 存储管理:缓存 JSONL 查看/清空、dev-capture 日志查看/删除、session 清理
  router.get('/storage', async (_req, res) => {
    const cache = getResultCache();
    await cache.whenReady();
    res.json({
      cache: {
        count: cache.size(),
        entries: Array.from(cache.entries()).map(([k]) => k),
      },
      devCapture: {
        count: getDevCaptureCount(),
        entries: listDevCapture(),
      },
      sessions: {
        count: getSessionCount(),
      },
    });
  });

  router.post('/storage/clear', async (req, res) => {
    const target = typeof req.body?.target === 'string' ? req.body.target : '';
    if (target === 'cache') {
      const cache = getResultCache();
      await cache.whenReady();
      await cache.clear();
      res.json({ ok: true, cleared: 'cache' });
    } else if (target === 'devCapture') {
      await clearDevCapture();
      res.json({ ok: true, cleared: 'devCapture' });
    } else if (target === 'sessions') {
      clearAllSessions();
      res.json({ ok: true, cleared: 'sessions' });
    } else {
      res.status(400).json({ error: 'invalid_target', detail: 'target 必须是 cache / devCapture / sessions 之一' });
    }
  });

  return router;
}
