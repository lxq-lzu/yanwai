/**
 * 极简日志。stdout 只输出结构化行,不带任何凭证。
 * 见 02 文档 11.2:诊断信息只展示凭证来源/是否配置/长度/SHA-256 短前缀,不展示完整值。
 */

type Level = 'info' | 'warn' | 'error';

function line(level: Level, msg: string, extra?: Record<string, unknown>) {
  const entry = { t: Date.now(), level, msg, ...extra };
  const out = JSON.stringify(entry);
  if (level === 'error') console.error(out);
  else console.log(out);
}

export const logger = {
  info: (msg: string, extra?: Record<string, unknown>) => line('info', msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => line('warn', msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => line('error', msg, extra),
};

/** 诊断用:只展示凭证来源信息,绝不展示完整值 */
export function maskSecret(secret: string): string {
  if (!secret) return '(未配置)';
  if (secret.length <= 8) return '****';
  return `${secret.slice(0, 4)}...${secret.slice(-4)} (len=${secret.length})`;
}
