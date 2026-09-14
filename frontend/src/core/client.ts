/**
 * 言外 · NDJSON 客户端
 *
 * 唯一职责:把 ExtractedContext / sessionId / 用户输入翻译成 HTTP 请求,
 * 用 fetch + ReadableStream 逐行解析 NDJSON,通过 onEvent 回调把 StreamEvent 吐出去。
 *
 * 不知道 DOM、不知道气泡长什么样、不知道选区是怎么来的——
 * 这个文件删掉/换成别的实现(比如换成 WebSocket),只需要保证
 * `explain/reangle/followup/comments` 四个方法签名不变,app.ts 不用改。
 *
 * requestSeq 防串台:每次调用生成一个自增 seq,由调用方(app.ts)负责判断
 * "这次响应还是不是当前显示中的这次请求"——client 本身只负责透传 start 事件里的 seq,
 * 不做过滤决策(过滤逻辑属于气泡/装配层,client 保持无状态)。
 */

import type { ExtractedContext, StreamEvent } from './types.js';

export interface ExplainClientOptions {
  baseUrl?: string;
}

export interface StreamCallOptions {
  onEvent: (event: StreamEvent) => void;
  signal?: AbortSignal;
}

export interface ExplainClient {
  /** 首次划词解析 */
  explain(
    ctx: ExtractedContext,
    opts: StreamCallOptions,
    extra?: { unlimited?: boolean; longForm?: boolean }
  ): Promise<void>;
  /** 换个角度:只重生成正文,复用已有证据 */
  reangle(sessionId: string, opts: StreamCallOptions): Promise<void>;
  /** 底部输入框追问 */
  followup(sessionId: string, message: string, opts: StreamCallOptions): Promise<void>;
}

let seqCounter = 0;

/** 内部工具:逐行读取 NDJSON 响应体,每解析出一行 JSON 就回调一次 */
async function consumeNdjson(res: Response, onEvent: (event: StreamEvent) => void): Promise<void> {
  if (!res.body) {
    // 环境不支持流式 body(极少见),退化为一次性读取整个响应再按行拆分
    const text = await res.text();
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      onEvent(JSON.parse(line) as StreamEvent);
    }
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let newlineIdx: number;
    while ((newlineIdx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);
      if (!line.trim()) continue;
      onEvent(JSON.parse(line) as StreamEvent);
    }
  }

  if (buffer.trim()) {
    onEvent(JSON.parse(buffer) as StreamEvent);
  }
}

function extractedContextToRequestBody(ctx: ExtractedContext): Record<string, unknown> {
  const body: Record<string, unknown> = {
    target: ctx.target,
    surroundings: ctx.surroundings,
    scope: ctx.scope,
    anchor: ctx.anchor,
  };
  // 评论作为 c 层「位置·时间·评论」的资料,随首次解析请求带到后端(见 O4)
  if (ctx.comments?.length) body.comments = ctx.comments;
  return body;
}

export function createExplainClient(options: ExplainClientOptions = {}): ExplainClient {
  const baseUrl = options.baseUrl ?? '';

  async function postStream(path: string, body: unknown, opts: StreamCallOptions): Promise<void> {
    seqCounter += 1;
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });

    if (!res.ok) {
      // 非流式错误响应(如 404/429/400),构造一个合成的 error+done 事件序列,
      // 让上层(气泡)统一按 StreamEvent 处理,不需要额外分支
      opts.onEvent({
        t: 'error',
        stage: 'body',
        msg: `request_failed_${res.status}`,
        fatal: true,
      });
      return;
    }

    await consumeNdjson(res, opts.onEvent);
  }

  return {
    async explain(ctx, opts, extra) {
      const body = extractedContextToRequestBody(ctx);
      // 「无限探索」开启带 options.unlimited,后端据此跳过整体超时(见 O2);
      // 「超长对话」开启带 options.longForm,后端据此不追加字数约束、不传 maxTokens。
      const options: Record<string, unknown> = {};
      if (extra?.unlimited) options.unlimited = true;
      if (extra?.longForm) options.longForm = true;
      if (Object.keys(options).length) {
        body.options = { ...(body.options as Record<string, unknown> | undefined), ...options };
      }
      await postStream('/api/v1/explain', body, opts);
    },

    async reangle(sessionId, opts) {
      await postStream(`/api/v1/explain/${encodeURIComponent(sessionId)}/reangle`, {}, opts);
    },

    async followup(sessionId, message, opts) {
      await postStream('/api/v1/followup', { sessionId, message }, opts);
    },
  };
}
