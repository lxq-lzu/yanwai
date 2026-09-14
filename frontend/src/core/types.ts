/**
 * 言外 · 前端核心类型
 *
 * 这个文件是前端内部模块之间的数据契约来源,类比 backend/types.ts 的角色。
 * 原则:这里的类型只描述"前端内部约定",不是后端契约的复制品——
 * `ExtractedContext` 是适配器 (adapters/*) 产出给 core 消费的中间形态,
 * 由 core/client.ts 负责再转换成 backend/types.ts 里的 ExplainRequest。
 * 这样适配器完全不需要认识后端的请求体形状,反过来 core 也不需要认识 DOM。
 */

// ---------------------------------------------------------------------------
// 一、与后端对齐的最小类型子集(避免整个前端 import 后端源码,保持前端可独立打包)
// ---------------------------------------------------------------------------

export type Role = 'title' | 'container' | 'before' | 'after' | 'sibling' | 'meta';

export interface Surrounding {
  role: Role;
  text: string;
  id?: string;
  weight?: number;
  /** 该片段所属内容的发布时间:时间戳(ms)或 ISO 字符串。采集到才填,用于时间敏感语义。 */
  publishedAt?: string | number;
}

export type ScopeKind = 'question' | 'answer' | 'comment';

export interface ScopeAuthor {
  name: string;
  urlToken?: string;
  badge?: string;
}

export interface ScopeSignals {
  vote?: number;
  like?: number;
}

export interface ScopeParent {
  kind: 'answer' | 'question';
  id: string;
}

export interface Scope {
  kind: ScopeKind;
  id: string;
  author?: ScopeAuthor;
  signals?: ScopeSignals;
  quoted: boolean;
  parent?: ScopeParent;
  /** 回答/评论的发布时间:时间戳(ms)或 ISO 字符串。梗/绰号/黑话的含义随发布时间漂移,模型需要它。 */
  publishedAt?: string | number;
}

export interface Anchor {
  exact: string;
  prefix?: string;
  suffix?: string;
  blockIndex?: number;
}

export interface RefItem {
  n: number;
  anchor?: string;
  quote: string;
  author?: string;
  url?: string;
}

/** 与 backend/types.ts 的 StreamEvent 保持字段一致,只允许加法演进 */
export type StreamEvent =
  | { v: 1; t: 'start'; requestId: string; seq: number }
  | { t: 'lead_delta'; d: string }
  | { t: 'lead_end' }
  | { t: 'directions'; items: Array<{ id: string; hasMaterial: boolean }> }
  | { t: 'body_delta'; d: string }
  | { t: 'refs'; items: RefItem[] }
  | { t: 'body_end'; body?: string }
  | { t: 'error'; stage: 'lead' | 'body'; msg: string; fatal: boolean }
  | { t: 'done'; usage?: { tokens: number }; cached: boolean; sessionId?: string };

// ---------------------------------------------------------------------------
// 二、适配器产出的中间形态
// ---------------------------------------------------------------------------

/**
 * 适配器 (SiteAdapter.extract) 的唯一输出形状。core/selection.ts 只认识这个类型,
 * 不认识任何 DOM 或站点细节;core/client.ts 只把这个类型翻译成 HTTP 请求体。
 */
export interface ExtractedContext {
  target: { text: string };
  surroundings: Surrounding[];
  scope: Scope;
  anchor: Anchor;
  /** 命中哪一层降级策略,纯调试/可观测性用途,不参与业务逻辑 */
  hitLevel?: string;
  /** 评论片段(前端同源 DOM 抓取),作为 c 层「位置·时间·评论」的资料喂给后端 */
  comments?: CommentInfo[];
}

// ---------------------------------------------------------------------------
// 三、评论片段(前端同源 DOM 抓取,作为 c 层「位置·时间·评论」的资料)
// ---------------------------------------------------------------------------

/** 评论片段:前端同源 DOM 抓取,与 backend CommentInfo 对齐。 */
export interface CommentInfo {
  text: string;
  author?: string;
  /** 评论链接(可跳回原文) */
  url?: string;
}
