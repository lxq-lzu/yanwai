/**
 * Mock LLM Provider。零网络请求,MOCK=1 时使用。
 * 这不只是测试便利——它是"抽象是否真的解耦"的证明(见 02 文档「明确不做」之外的关键保险项),
 * 也是评审期间断网/额度耗尽/DeepSeek 抖动时的兜底演示模式。
 */

import type { LLMProvider, LLMMessage, LLMCallOptions } from '../types.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 把一段文本切成若干小块,模拟流式增量,块间有小延迟 */
async function* chunk(text: string, chunkSize = 6, delayMs = 15): AsyncIterable<string> {
  for (let i = 0; i < text.length; i += chunkSize) {
    yield text.slice(i, i + chunkSize);
    await sleep(delayMs);
  }
}

/** 判断这是路由请求还是生成请求:路由请求要求 jsonMode */
function isRouteRequest(opts?: LLMCallOptions): boolean {
  return opts?.jsonMode === true;
}

function mockRouteResponse(userText: string): string {
  const hasQuote = /["「」“”]/.test(userText);
  const hasAcronym = /[A-Z]{2,}/.test(userText);
  const angles: string[] = [];
  if (hasAcronym) angles.push('term');
  if (hasQuote || /不是.*吗|又开始|好家伙/.test(userText)) angles.push('subtext');
  return JSON.stringify({
    angles,
    entities: hasAcronym ? ['MOCK_ENTITY'] : [],
    needsEvidence: angles.includes('community') || angles.includes('hotspot'),
    tone: hasQuote ? 'ironic' : 'neutral',
    confidence: 0.6,
    reason: '(mock 规则判断)',
  });
}

function mockLeadResponse(): string {
  return '（Mock）这句话大概是在说一件事，具体解释见下方。';
}

function mockBodyResponse(): string {
  return '（Mock 融合正文）这是离线模式下的占位解释，用于验证完整链路可以在零网络请求下跑通。真实模式下这里会是 DeepSeek 生成的融合解释。';
}

export function createMockProvider(): LLMProvider {
  return {
    name: 'mock',
    isAvailable: () => true,

    async generate(messages: LLMMessage[], opts?: LLMCallOptions): Promise<string> {
      const userMsg = messages.find((m) => m.role === 'user')?.content ?? '';
      if (isRouteRequest(opts)) return mockRouteResponse(userMsg);
      // 用一个简单信号区分 lead vs body:lead 提示词里通常含"人话"或"翻译"
      const systemMsg = messages.find((m) => m.role === 'system')?.content ?? '';
      if (/翻译成大白话|人话/.test(systemMsg)) return mockLeadResponse();
      return mockBodyResponse();
    },

    stream(messages: LLMMessage[], opts?: LLMCallOptions): AsyncIterable<string> {
      const text = isRouteRequest(opts)
        ? mockRouteResponse(messages.find((m) => m.role === 'user')?.content ?? '')
        : (() => {
            const systemMsg = messages.find((m) => m.role === 'system')?.content ?? '';
            return /翻译成大白话|人话/.test(systemMsg) ? mockLeadResponse() : mockBodyResponse();
          })();
      return chunk(text);
    },
  };
}
