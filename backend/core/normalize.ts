/**
 * 归一化 + 缓存键构造。见 02 文档第六节:
 * "上下文摘要必须先归一化再哈希,否则命中率接近零"。
 */

import { createHash } from 'node:crypto';
import type { ExplainRequest, Scope } from '../types.js';

/** 去除不定空白、常见 URL 追踪参数残留,统一大小写不动(中文为主,大小写无意义) */
export function normalizeText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[​‌‍﻿]/g, ''); // 零宽字符,知乎 DOM 里常见
}

/** scope 的规范化表示:同一条回答/评论下,字段顺序和存在性不应影响缓存键 */
function normalizeScope(scope: Scope): string {
  const parts: string[] = [scope.kind, scope.id, scope.quoted ? '1' : '0'];
  if (scope.parent) parts.push(scope.parent.kind, scope.parent.id);
  return parts.join('|');
}

/**
 * 归一化后的上下文摘要:sibling 按 id 排序、按角色分组截断,避免 DOM 渲染顺序抖动影响命中率。
 */
export function normalizeContextDigest(req: ExplainRequest): string {
  const target = normalizeText(req.target.text);
  const scope = normalizeScope(req.scope);
  const surroundings = [...req.surroundings]
    .map((s) => ({ ...s, text: normalizeText(s.text) }))
    .sort((a, b) => {
      if (a.role !== b.role) return a.role.localeCompare(b.role);
      return (a.id ?? '').localeCompare(b.id ?? '');
    })
    .map((s) => `${s.role}:${s.id ?? ''}:${s.text.slice(0, 200)}`)
    .join('||');
  return `${target}##${scope}##${surroundings}`;
}

/**
 * 缓存键 = hash(归一化文本 + scope + 模型 + 参与生成的提示词 rev)。
 * rev 必须在这里,否则改完提示词读到的是旧缓存,会误判"改动没生效"。
 */
export function buildCacheKey(params: {
  request: ExplainRequest;
  model: string;
  promptRevs: Record<string, number>;
}): string {
  const digest = normalizeContextDigest(params.request);
  const revPart = Object.entries(params.promptRevs)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, rev]) => `${id}@${rev}`)
    .join(',');
  const raw = `${digest}::model=${params.model}::rev=${revPart}`;
  return createHash('sha256').update(raw).digest('hex');
}

/** 60 秒内重复划选判定用的更轻量 key(见 02 文档 5.2 误触发过滤) */
export function buildDedupeKey(req: ExplainRequest): string {
  return `${normalizeText(req.target.text)}::${req.scope.kind}:${req.scope.id}`;
}
