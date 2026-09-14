/**
 * OpenAI 兼容协议适配器。DeepSeek / 通义 / Kimi / 本地 ollama、vLLM 共用一个适配器。
 * 见 02 文档「明确不做」:LLM 抽象不超出"异步可迭代的文本增量"的部分。
 */

import type { LLMProvider, LLMMessage, LLMCallOptions } from '../types.js';
import { logger } from '../core/logger.js';

export interface OpenAICompatConfig {
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
}

interface ChatCompletionChunk {
  choices: Array<{ delta?: { content?: string }; finish_reason?: string | null }>;
}

export function createOpenAICompatProvider(cfg: OpenAICompatConfig): LLMProvider {
  const endpoint = `${cfg.baseUrl.replace(/\/$/, '')}/v1/chat/completions`;

  function isAvailable(): boolean {
    return cfg.apiKey.length > 0;
  }

  async function generate(messages: LLMMessage[], opts?: LLMCallOptions): Promise<string> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: false,
        temperature: opts?.temperature ?? 0.7,
        max_tokens: opts?.maxTokens,
        ...(opts?.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${cfg.name} generate failed: ${res.status} ${body.slice(0, 200)}`);
    }
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0]?.message?.content ?? '';
  }

  async function* stream(messages: LLMMessage[], opts?: LLMCallOptions): AsyncIterable<string> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        messages,
        stream: true,
        temperature: opts?.temperature ?? 0.7,
        max_tokens: opts?.maxTokens,
        ...(opts?.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok || !res.body) {
      const body = await res.text().catch(() => '');
      throw new Error(`${cfg.name} stream failed: ${res.status} ${body.slice(0, 200)}`);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        // 关键:{ stream: true } 防止多字节字符被切在两个 chunk 中间(见 02 文档中文流式坑)
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // 留住最后一个不完整的行

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === '[DONE]') return;
          try {
            const json: ChatCompletionChunk = JSON.parse(payload);
            const delta = json.choices[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            // 心跳注释或不完整 JSON,忽略
          }
        }
      }
    } finally {
      reader.releaseLock?.();
    }
  }

  return {
    name: cfg.name,
    isAvailable,
    generate,
    stream: (messages, opts) => stream(messages, opts),
  };
}
