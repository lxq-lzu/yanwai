/**
 * term 方向:术语解释。资料源链 = [llm](config.directions 默认),词义靠模型知识。
 * distill:LLM 直接产出 points(见 10 文档第四节「term → LLM 直接产出 points」)。
 */

import type { Direction, DirectionInput, FeedbackPoint, RawMaterial } from '../../types.js';
import { PROMPTS, renderPrompt } from '../prompts/index.js';
import { createDirection, parseLLMPoints, resolveSources } from './shared.js';

export function createTermDirection(): Direction {
  return createDirection({
    id: 'term',
    name: '术语解释',
    sources: resolveSources('term', (input) =>
      renderPrompt(PROMPTS.termRetrieve!.template, input.request.scope.publishedAt),
    ),
    async distill(material: RawMaterial, _input: DirectionInput): Promise<FeedbackPoint[]> {
      if (material.sourceId !== 'llm') return [];
      return parseLLMPoints(String(material.data), 'term');
    },
  });
}
