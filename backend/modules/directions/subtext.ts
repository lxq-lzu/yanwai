/**
 * subtext 方向:潜台词解读。资料源链 = [llm → zhihu_search](config.directions 默认)。
 * distill 两种模式:
 *   - llm → 模型直接产出 points(主路径)
 *   - zhihu_search → 站内搜索片段映射成 points(搜梗的由来/用法)
 */

import type { Direction, DirectionInput, FeedbackPoint, RawMaterial } from '../../types.js';
import { PROMPTS, renderPrompt } from '../prompts/index.js';
import { createDirection, parseLLMPoints, resolveSources } from './shared.js';

interface SearchItem {
  ContentText?: string;
  Title?: string;
}

export function createSubtextDirection(): Direction {
  return createDirection({
    id: 'subtext',
    name: '潜台词解读',
    sources: resolveSources('subtext', (input) =>
      renderPrompt(PROMPTS.subtextRetrieve!.template, input.request.scope.publishedAt),
    ),

    async distill(material: RawMaterial, _input: DirectionInput): Promise<FeedbackPoint[]> {
      if (material.sourceId === 'llm') {
        return parseLLMPoints(String(material.data), 'subtext');
      }

      if (material.sourceId === 'zhihu_search') {
        const items = (material.data ?? []) as SearchItem[];
        return items
          .map((it, i) => ({
            kind: 'subtext' as const,
            text: (it.ContentText ?? it.Title ?? '').replace(/<\/?em>/g, ''),
            ref: i,
          }))
          .filter((p) => p.text.length > 0);
      }

      return [];
    },
  });
}
