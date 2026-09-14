/**
 * 言外 · 共享类型定义
 *
 * 这个文件是整个后端的数据契约来源。核心原则(见 docs/02-技术架构.md 第二节):
 * 上下文和证据用站点无关的角色模型描述,不出现任何 "questionTitle"/"voteCount" 这类
 * 知乎专有字段名,也不允许出现 `if (site === 'zhihu')` 这类分支。
 */

// ---------------------------------------------------------------------------
// 一、上下文角色模型(role 词表)
// ---------------------------------------------------------------------------

/** 封闭词表,不要新增。适配器的全部工作就是把 DOM 映射到这六个角色上。 */
export type Role = 'title' | 'container' | 'before' | 'after' | 'sibling' | 'meta';

export interface Surrounding {
  role: Role;
  text: string;
  /** sibling 类角色可带 id,方便证据排序和去重 */
  id?: string;
  /** 0~1,预算分配器排序用 */
  weight?: number;
  /** 该片段所属内容的发布时间:时间戳(ms)或 ISO 字符串。采集到才填,用于时间敏感语义。 */
  publishedAt?: string | number;
}

export interface Target {
  text: string;
}

// ---------------------------------------------------------------------------
// 二、精确锚定:作用域 + 位置
// ---------------------------------------------------------------------------

/** 用户实际会划选的三种来源,不只是回答。见 02 文档「上下文与证据模型」表。 */
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

export interface ScopeQuestionRef {
  id: string;
  title: string;
}

/** kind === 'comment' 时必填,否则后端不知道去哪找"同问题下其他回答"这类证据。 */
export interface ScopeParent {
  kind: 'answer' | 'question';
  id: string;
}

export interface Scope {
  kind: ScopeKind;
  id: string;
  author?: ScopeAuthor;
  signals?: ScopeSignals;
  question?: ScopeQuestionRef;
  /** 选区是否落在 blockquote 内。true 时正文应归因为"被引用者的话",不是当前作者观点。 */
  quoted: boolean;
  /** kind === 'comment' 时必填 */
  parent?: ScopeParent;
  /** 回答/评论的发布时间:时间戳(ms)或 ISO 字符串。梗/绰号/黑话的含义随发布时间漂移,模型需要它。 */
  publishedAt?: string | number;
}

/**
 * W3C Web Annotation 的 TextQuoteSelector 思路:靠文本内容重新定位,不用字符偏移或 XPath。
 * 知乎会懒加载、异步插入元素、回答会折叠展开,offset/XPath 极易失效。
 */
export interface Anchor {
  exact: string;
  prefix?: string;
  suffix?: string;
  blockIndex?: number;
}

// ---------------------------------------------------------------------------
// 三、请求体
// ---------------------------------------------------------------------------

export interface ExplainRequest {
  target: Target;
  surroundings: Surrounding[];
  scope: Scope;
  anchor: Anchor;
  options?: {
    /** 「无限探索」:true 表示不限时(跳过方向检索+综合的整体超时)。前端持久化开关传入。 */
    unlimited?: boolean;
    /** 「超长对话」:true = 生成不限长;缺省/false = 限长(约 150 字 + maxTokens)。前端持久化开关传入。 */
    longForm?: boolean;
  };
  /** 追问/换个角度时携带,首次请求不传 */
  sessionId?: string;
  /**
   * 评论片段(前端同源 DOM 抓取)。作为 c 层「位置·时间·评论」里「评论」的资料,
   * 生成解析时喂给综合器;无评论/非 answer scope 不传。
   */
  comments?: CommentInfo[];
}

// ---------------------------------------------------------------------------
// 四、证据(评论片段 + 方向检索模型)
// ---------------------------------------------------------------------------

/** 评论片段:前端同源 DOM 抓取,作为 c 层「位置·时间·评论」里「评论」的资料。 */
export interface CommentInfo {
  text: string;
  author?: string;
  /** 评论链接(可跳回原文) */
  url?: string;
}

// ---------------------------------------------------------------------------
// 四之二、方向检索模型(重构新增,见 10-方向重构方案 第三节)
//
// 「方向」是去找参考资料的渠道,不是答案角度。每个方向 = 一条资料源链 + 一个浓缩器,
// 资料源按序降级,全失败则该方向 hasMaterial: false,综合器跳过。
// ---------------------------------------------------------------------------

/** 方向输入:复用现有 context,不新增站点专有字段。 */
export interface DirectionInput {
  text: string;
  request: ExplainRequest;
  budget: {
    /** 剩余毫秒数 */
    remainingMs: number;
  };
}

/** 原始资料:资料源返回,可能来自 API(JSON)或 LLM(原始文本)。 */
export interface RawMaterial {
  /** 来自哪个资料源,如 'zhihu_hot' | 'llm' */
  sourceId: string;
  /** API 的 JSON,或 LLM 的原始文本 */
  data: unknown;
}

/** 结构化信息点:浓缩后,综合器吃这个。 */
export interface FeedbackPoint {
  kind: 'term' | 'event' | 'subtext' | 'community' | 'other';
  /** 浓缩信息点,一句话一个 */
  text: string;
  /** 关联到 sources[index] */
  ref?: number;
  /** 0~1,可选 */
  confidence?: number;
}

/** 来源标注:可跳回原文 / 标注出处。 */
export interface Source {
  type: 'zhihu_search' | 'zhihu_hot' | 'zhihu_global' | 'zhihu_comment' | 'llm' | 'page_dom';
  /** 来源片段 */
  text: string;
  url?: string;
  author?: string;
}

/** 方向的最终反馈。 */
export interface DirectionFeedback {
  /** 'term' | 'hotspot' | 'subtext' | 'community' */
  id: string;
  /** 有没有捞到料;false 时综合器自动跳过 */
  hasMaterial: boolean;
  points: FeedbackPoint[];
  sources: Source[];
}

/** 资料源:可插拔、可降级的最小单元。 */
export interface DataSource {
  id: string;
  /** config.features 映射 */
  enabled: boolean;
  /** null = 不可用,触发降级到下一个源 */
  retrieve(input: DirectionInput): Promise<RawMaterial | null>;
  timeoutMs: number;
}

/** 方向:一条源链 + 一个浓缩器。 */
export interface Direction {
  id: string;
  name: string;
  /** 按序降级 */
  sources: DataSource[];
  distill(material: RawMaterial, input: DirectionInput): Promise<FeedbackPoint[]>;
  retrieve(input: DirectionInput): Promise<DirectionFeedback>;
}

// ---------------------------------------------------------------------------
// 六、引用与流式事件
// ---------------------------------------------------------------------------

export interface RefItem {
  n: number;
  anchor?: string;
  quote: string;
  author?: string;
  url?: string;
}

/**
 * NDJSON 协议。规则(见 02 文档第四节):
 * - start 带 v 字段标协议版本
 * - 消费者必须忽略未知 t 和未知字段,只允许加法演进
 */
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
// 七、LLM Provider 接口
// ---------------------------------------------------------------------------

export interface LLMMessage {
  role: 'system' | 'user';
  content: string;
}

export interface LLMCallOptions {
  temperature?: number;
  /** 路由阶段要求 JSON 输出时置真 */
  jsonMode?: boolean;
  maxTokens?: number;
}

export interface LLMProvider {
  name: string;
  isAvailable(): boolean;
  /** 异步可迭代的文本增量,不做超出这个语义的抽象(见 02 文档「明确不做」) */
  stream(messages: LLMMessage[], opts?: LLMCallOptions): AsyncIterable<string>;
  generate(messages: LLMMessage[], opts?: LLMCallOptions): Promise<string>;
}

// ---------------------------------------------------------------------------
// 九、缓存与会话
// ---------------------------------------------------------------------------

export interface CachedResult {
  /** 完整事件序列,供命中时原样回放(除 start.requestId/seq 会替换成当次请求的) */
  events: StreamEvent[];
  /** 是否含时效性证据(热点/社区),决定 TTL 分层 */
  timeSensitive: boolean;
  createdAt: number;
}

export interface SessionState {
  sessionId: string;
  request: ExplainRequest;
  /** 各方向的检索反馈,供「换个角度」/追问复用(见 10 文档第三节) */
  feedback: DirectionFeedback[];
  /** 扁平化的站内来源(所有有料方向 sources 拼合、过滤 llm),供 [ref:N] 越界校验 */
  sources: Source[];
  lastResult: {
    lead: string;
    body: string;
    refs: RefItem[];
  };
  createdAt: number;
}

// ---------------------------------------------------------------------------
// 十、提示词版本化
// ---------------------------------------------------------------------------

export interface PromptTemplate {
  id: string;
  rev: number;
  locale: string;
  template: string;
}
