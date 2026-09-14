/**
 * 方向层共享助手。四个方向模块(term/hotspot/subtext/community)共用的最小实现:
 * - buildDataSource:源 id → DataSource 工厂(API 源来自 modules/evidence,llm 源来自 llm-source)
 * - resolveSources:从 config.directions 读某个方向的源链,装配成 DataSource[]
 * - createDirection:方向默认 retrieve(遍历源链降级 → distill 浓缩)
 * - parseLLMPoints:LLM 输出的 JSON 数组 → FeedbackPoint[]
 * - buildSources:RawMaterial → Source[](供 DirectionFeedback.sources 与 points 的 ref 关联)
 *
 * 见 10-方向重构方案 第三/四节:方向只找料,综合器才说话;「没料」是常态不是异常。
 */

import type { DataSource, Direction, DirectionFeedback, DirectionInput, FeedbackPoint, RawMaterial, Source } from '../../types.js';
import { config } from '../../config.js';
import { logger } from '../../core/logger.js';
import { createLLMDataSource } from './llm-source.js';
import { createHotListDataSource } from '../evidence/hot-list.js';
import { createGlobalSearchDataSource } from '../evidence/global-search.js';
import { createZhihuSearchDataSource } from '../evidence/zhihu-search.js';
import { createZhihuCommentDataSource } from '../evidence/zhihu-comments.js';

/** 清理 API 返回的 <em> 高亮标签(与旧 evidence 模块的 stripHighlight 一致) */
function stripHighlight(text: string): string {
  return text.replace(/<\/?em>/g, '');
}

/**
 * 每个方向最多保留的信息点数,避免综合器上下文过长、注意力被稀释。
 * 方向层只「浓缩」,不判相关性;相关性/无料判断统一留给综合器(见 11 文档主题一)。
 * 数值可调:越大综合器吃得越多,但越稀释「本意优先」的聚焦度。
 */
const MAX_POINTS_PER_DIRECTION = 8;

/** 把信息点截断到上限。截断后各方向的 ref 仍指回原始 sources 下标,不受影响。 */
function truncatePoints(points: FeedbackPoint[]): FeedbackPoint[] {
  return points.length <= MAX_POINTS_PER_DIRECTION ? points : points.slice(0, MAX_POINTS_PER_DIRECTION);
}

/** 源 id → DataSource 工厂。id 与 config.directions 链 + Source.type 对齐(见 10 文档)。 */
export function buildDataSource(
  id: string,
  buildLLMPrompt?: (input: DirectionInput) => string,
): DataSource {
  switch (id) {
    case 'llm':
      return createLLMDataSource({ buildSystemPrompt: buildLLMPrompt });
    case 'zhihu_hot':
      return createHotListDataSource();
    case 'zhihu_global':
      return createGlobalSearchDataSource();
    case 'zhihu_search':
      return createZhihuSearchDataSource();
    case 'zhihu_comment':
      return createZhihuCommentDataSource();
    default:
      throw new Error(`未知的资料来源 id: ${id}`);
  }
}

/** 从 config.directions 读某个方向的源链,装配成 DataSource[]。 */
export function resolveSources(directionId: string, buildLLMPrompt?: (input: DirectionInput) => string): DataSource[] {
  const entry = config.directions.find((d) => d.id === directionId);
  const ids = entry?.sources ?? [];
  return ids.map((id) => buildDataSource(id, buildLLMPrompt));
}

/**
 * 默认 retrieve:遍历 sources 链,第一个返回非 null 的料命中,交给 distill;
 * 全失败则 hasMaterial: false。distill 失败也不阻塞主流程,降级为 hasMaterial: false。
 * 每个源独立超时(source.timeoutMs),到点带着「无料」走,交给下一个源。
 */
export function createDirection(opts: {
  id: string;
  name: string;
  sources: DataSource[];
  distill: (material: RawMaterial, input: DirectionInput) => Promise<FeedbackPoint[]>;
}): Direction {
  return {
    id: opts.id,
    name: opts.name,
    sources: opts.sources,
    distill: opts.distill,

    async retrieve(input: DirectionInput): Promise<DirectionFeedback> {
      for (const source of opts.sources) {
        if (!source.enabled) continue;

        let material: RawMaterial | null = null;
        try {
          material = await Promise.race([
            source.retrieve(input),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), source.timeoutMs)),
          ]);
        } catch (err) {
          logger.warn('direction_source_failed', { direction: opts.id, source: source.id, err: String(err) });
          material = null;
        }

        if (material) {
          try {
            const points = truncatePoints(await opts.distill(material, input));
            return { id: opts.id, hasMaterial: points.length > 0, points, sources: buildSources(material) };
          } catch (err) {
            logger.warn('direction_distill_failed', { direction: opts.id, source: material.sourceId, err: String(err) });
            return { id: opts.id, hasMaterial: false, points: [], sources: [] };
          }
        }
      }

      return { id: opts.id, hasMaterial: false, points: [], sources: [] };
    },
  };
}

/**
 * LLM 输出的 JSON 数组 → FeedbackPoint[]。容忍 markdown 代码围栏、前后杂文本,
 * 解析失败降级为按行切分(每行一个信息点)。LLM 点是训练知识兜底,不挂 ref。
 */
export function parseLLMPoints(text: string, kind: FeedbackPoint['kind']): FeedbackPoint[] {
  const arr = extractJsonArray(text);
  if (arr) {
    const points: FeedbackPoint[] = [];
    for (const item of arr) {
      const s =
        typeof item === 'string'
          ? item
          : item && typeof item === 'object'
            ? String((item as { text?: unknown }).text ?? '')
            : '';
      const t = s.trim();
      if (t) points.push({ kind, text: t });
    }
    if (points.length) return points;
  }

  // 降级:按行切分,每行一个信息点
  return text
    .split(/\r?\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((t) => ({ kind, text: t }));
}

/** 从一段文本里抽取第一个 JSON 数组,拿不到返回 null。 */
function extractJsonArray(text: string): unknown[] | null {
  const trimmed = text.trim();

  const tryParse = (s: string): unknown[] | null => {
    try {
      const v = JSON.parse(s);
      return Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  };

  const direct = tryParse(trimmed);
  if (direct) return direct;

  // markdown 代码围栏
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const inside = tryParse(fenced[1]!.trim());
    if (inside) return inside;
  }

  // 取第一个 [ 到最后一个 ] 的区间
  const first = trimmed.indexOf('[');
  const last = trimmed.lastIndexOf(']');
  if (first >= 0 && last > first) {
    const slice = tryParse(trimmed.slice(first, last + 1));
    if (slice) return slice;
  }

  return null;
}

/**
 * RawMaterial → Source[]。points 的 ref 指到这里:API 源的 points 与 sources 是平行数组
 * (ref = 该条在数组里的下标),LLM 源只有一个 llm 条目、points 不挂 ref。
 */
export function buildSources(material: RawMaterial): Source[] {
  const data = material.data;
  switch (material.sourceId) {
    case 'llm':
      return [{ type: 'llm', text: typeof data === 'string' ? data.slice(0, 200) : '' }];

    case 'zhihu_hot': {
      const items = (data ?? []) as Array<{ Title?: string; Summary?: string; Url?: string }>;
      return items.map((it) => ({
        type: 'zhihu_hot' as const,
        text: it.Summary ? `${it.Title}：${it.Summary}` : (it.Title ?? ''),
        url: it.Url,
      }));
    }

    case 'zhihu_global': {
      const items = (data ?? []) as Array<{ ContentText?: string; Url?: string; AuthorName?: string }>;
      return items.map((it) => ({
        type: 'zhihu_global' as const,
        text: stripHighlight(it.ContentText ?? ''),
        url: it.Url,
        author: it.AuthorName,
      }));
    }

    case 'zhihu_search': {
      const items = (data ?? []) as Array<{ ContentText?: string; Url?: string; AuthorName?: string }>;
      return items.map((it) => ({
        type: 'zhihu_search' as const,
        text: stripHighlight(it.ContentText ?? ''),
        url: it.Url,
        author: it.AuthorName,
      }));
    }

    case 'zhihu_comment': {
      const items = (data ?? []) as Array<{ Content?: string; AuthorToken?: string }>;
      return items.map((it) => ({
        type: 'zhihu_comment' as const,
        text: it.Content ?? '',
        author: it.AuthorToken,
      }));
    }

    default:
      return [];
  }
}
