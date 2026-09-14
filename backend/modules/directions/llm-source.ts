/**
 * 通用 LLM 兜底源。每个方向源链的最后一级都是它——接口断了、API 没料,
 * 落到 LLM 用训练知识兜底(但下游综合器要标注「无站内证据」,见 00 文档铁律 4)。
 *
 * retrieve 直接把模型生成的原始文本塞进 RawMaterial.data,浓缩(distill)交给方向层(D4)。
 * D5 会把方向专属检索 prompt 挪进 prompts 注册表,这里先接收调用方传入的 system prompt,
 * 保证每个方向可以用不同的检索 prompt 复用同一个 LLM 源。
 */

import type { DataSource, DirectionInput, RawMaterial, LLMMessage } from '../../types.js';
import { getLLMProvider } from '../../llm/index.js';
import { config } from '../../config.js';
import { logger } from '../../core/logger.js';

export interface LLMSourceOptions {
  /** 生成原始料的 system 提示词,按方向不同。缺省用通用兜底提示词。 */
  buildSystemPrompt?: (input: DirectionInput) => string;
}

const DEFAULT_SYSTEM_PROMPT =
  '你是一个帮助读者理解知乎内容的助手。请针对选中文本给出相关的背景、术语或潜台词信息，不要编造。';

export function createLLMDataSource(options: LLMSourceOptions = {}): DataSource {
  return {
    id: 'llm',
    enabled: true,
    async retrieve(input: DirectionInput): Promise<RawMaterial | null> {
      const llm = getLLMProvider();
      try {
        const system = options.buildSystemPrompt ? options.buildSystemPrompt(input) : DEFAULT_SYSTEM_PROMPT;
        const messages: LLMMessage[] = [
          { role: 'system', content: system },
          { role: 'user', content: input.text },
        ];
        const text = await llm.generate(messages, { temperature: 0.4 });
        return { sourceId: 'llm', data: text };
      } catch (err) {
        logger.warn('llm_source_failed', { err: String(err) });
        return null;
      }
    },
    timeoutMs: config.evidence.timeoutMs,
  };
}
