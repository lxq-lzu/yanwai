/**
 * 言外 · 前端会话态
 *
 * 唯一职责:记住"当前显示中的这一轮对话"是哪个 sessionId,以及 requestSeq
 * 防串台计数器。纯内存状态容器,不发请求、不碰 DOM、不知道气泡长什么样。
 *
 * 按 02 文档 5.1:每次发起新一轮请求(explain/reangle/followup)时 seq 自增,
 * 装配层(app.ts)在收到事件时用 isCurrent(seq) 判断"这事件还是不是当前这轮的",
 * 不是就直接丢弃——这样快速划选 A 再划选 B,A 的迟到流式内容不会串进 B 的气泡。
 *
 * 这个文件删掉,app.ts 可以直接用几个局部变量替代,不影响 client.ts/bubble.ts/selection.ts。
 */

export interface ExplainSession {
  /** 后端会话 id,reangle/followup/comments 都靠它关联同一轮解析 */
  sessionId?: string;
  /** 当前这一轮请求的序号,用于丢弃过期事件 */
  seq: number;
}

export interface SessionStore {
  /** 开启新一轮请求前调用,返回本轮专属的 seq */
  nextSeq(): number;
  /** 判断某个事件携带的 seq 是否仍是当前这一轮 */
  isCurrent(seq: number): boolean;
  setSessionId(sessionId: string | undefined): void;
  getSessionId(): string | undefined;
  reset(): void;
}

export function createSessionStore(): SessionStore {
  let seqCounter = 0;
  let currentSeq = 0;
  let sessionId: string | undefined;

  return {
    nextSeq() {
      seqCounter += 1;
      currentSeq = seqCounter;
      return currentSeq;
    },
    isCurrent(seq: number) {
      return seq === currentSeq;
    },
    setSessionId(id) {
      sessionId = id;
    },
    getSessionId() {
      return sessionId;
    },
    reset() {
      sessionId = undefined;
    },
  };
}
