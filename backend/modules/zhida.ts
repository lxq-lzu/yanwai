/**
 * 知乎直答(生成类 Provider)。见 06 文档 3.7 + http-api.md「直答 API」。
 *
 * 定位:不在主链路里,是「换个角度·深挖」按钮专用——用户主动点击才调,天然低频,
 * 直答自带知乎内容检索,对热点背景类问题比裸模型强。日额度 100 次,按需调用。
 *
 * 协议:Chat Completions 风格(POST /v1/chat/completions, stream=true),走 Bearer
 * Access Secret。流式返回 SSE 帧(data: {...}),与 OpenAI 兼容协议同构,但直答的
 * delta 里可能同时带 reasoning_content(思考过程)与 content(最终回答),这里只取
 * content——用户要的是「深挖的结论」,不是思维链。
 */

import { config } from '../config.js';
import { logger } from '../core/logger.js';
import { getMetrics } from '../core/metrics.js';
import type { LLMMessage } from '../types.js';

interface ZhidaChunk {
  choices?: Array<{ delta?: { content?: string; reasoning_content?: string }; finish_reason?: string | null }>;
}

/** 是否有真实凭证可调直答(MOCK 模式下返回 true,走 mock 分支) */
export function isZhidaAvailable(): boolean {
  return config.mock || config.zhihu.accessSecret.length > 0;
}

async function* mockZhidaStream(): AsyncIterable<string> {
  const text = '（Mock 直答）这是离线模式下知乎直答的占位深挖内容，用于验证「换个角度·深挖」链路。真实模式下这里会是知乎直答（zhida）基于站内内容检索给出的更深一层解释。';
  for (let i = 0; i < text.length; i += 8) {
    yield text.slice(i, i + 8);
    await new Promise((r) => setTimeout(r, 10));
  }
}

/** 流式调用知乎直答,产出文本增量(只取 content,忽略 reasoning_content) */
export async function* streamZhida(messages: LLMMessage[]): AsyncIterable<string> {
  if (config.mock) {
    yield* mockZhidaStream();
    return;
  }
  if (!config.zhihu.accessSecret) {
    throw new Error('zhida no access secret');
  }

  getMetrics().incr('api:zhida');
  const endpoint = `${config.zhihu.zhidaApiBase.replace(/\/$/, '')}/v1/chat/completions`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.zhihu.accessSecret}`,
      'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
    },
    body: JSON.stringify({
      model: config.zhihu.zhidaModel,
      messages,
      stream: true,
    }),
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(`zhida stream failed: ${res.status} ${body.slice(0, 200)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue; // 心跳注释 ": keep-alive" 等
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') return;
        try {
          const json: ZhidaChunk = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) yield delta;
        } catch {
          // 不完整 JSON,忽略
        }
      }
    }
  } catch (err) {
    logger.warn('zhida_stream_error', { err: String(err) });
    throw err;
  } finally {
    reader.releaseLock?.();
  }
}
