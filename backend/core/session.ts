/**
 * 会话状态,纯内存 Map,TTL 30 分钟。见 02 文档 7.3:
 * "会话和限流丢了无所谓,重启后用户重新划一次就行。"
 * 不落盘,不用 JsonlStore。
 */

import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import type { SessionState } from '../types.js';

const sessions = new Map<string, SessionState>();

let cleanupTimer: NodeJS.Timeout | null = null;

function ensureCleanupTimer() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) {
      if (now - s.createdAt > config.session.ttlMs) sessions.delete(id);
    }
  }, 60_000);
  cleanupTimer.unref?.();
}

export function createSession(state: Omit<SessionState, 'sessionId' | 'createdAt'>): SessionState {
  ensureCleanupTimer();
  const sessionId = randomUUID();
  const full: SessionState = { ...state, sessionId, createdAt: Date.now() };
  sessions.set(sessionId, full);
  return full;
}

export function getSession(sessionId: string): SessionState | undefined {
  const s = sessions.get(sessionId);
  if (!s) return undefined;
  if (Date.now() - s.createdAt > config.session.ttlMs) {
    sessions.delete(sessionId);
    return undefined;
  }
  return s;
}

export function updateSession(sessionId: string, patch: Partial<SessionState>): void {
  const s = sessions.get(sessionId);
  if (!s) return;
  sessions.set(sessionId, { ...s, ...patch });
}

/** 管理后台「session 清理」:当前存活会话数。 */
export function getSessionCount(): number {
  return sessions.size;
}

/** 管理后台「session 清理」:清空全部会话(不区分是否过期)。 */
export function clearAllSessions(): void {
  sessions.clear();
}

/** 测试用:清空全部会话 */
export function _clearAllSessions(): void {
  clearAllSessions();
}
