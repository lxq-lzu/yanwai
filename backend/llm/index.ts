/**
 * Provider 注册与选择。MOCK=1 时强制使用 Mock,不管其他配置是否存在。
 */

import type { LLMProvider } from '../types.js';
import { config } from '../config.js';
import { createMockProvider } from './mock.js';
import { createOpenAICompatProvider } from './openai-compat.js';

let cached: LLMProvider | null = null;

export function getLLMProvider(): LLMProvider {
  if (cached) return cached;

  if (config.mock) {
    cached = createMockProvider();
    return cached;
  }

  const deepseek = createOpenAICompatProvider({
    name: 'deepseek',
    apiKey: config.deepseek.apiKey,
    baseUrl: config.deepseek.baseUrl,
    model: config.deepseek.model,
  });

  if (!deepseek.isAvailable()) {
    // 没配 key 时兜底用 mock,而不是直接抛错——保持"离线可跑"的保证
    cached = createMockProvider();
    return cached;
  }

  cached = deepseek;
  return cached;
}

/** 测试用:重置单例,允许切换 mock/真实 provider */
export function _resetLLMProvider(): void {
  cached = null;
}
