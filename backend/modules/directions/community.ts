/**
 * community 方向:社区理解。资料源链 = [zhihu_search → zhihu_comment → llm](config.directions 默认)。
 * 这是兜底渠道:去知乎站内补真实用户视角,解决「AI 自己拿不准」的问题(见 00 文档铁律 2)。
 * distill 两种模式:
 *   - zhihu_search / zhihu_comment → 站内讨论片段直接映射成 points
 *   - llm → 模型直接产出 points
 */

import type { Direction, DirectionInput, FeedbackPoint, RawMaterial } from '../../types.js';
import { PROMPTS, renderPrompt } from '../prompts/index.js';
import { createDirection, parseLLMPoints, resolveSources } from './shared.js';

interface SearchItem {
  ContentText?: string;
  Title?: string;
}

interface CommentItem {
  Content?: string;
}

export function createCommunityDirection(): Direction {
  return createDirection({
    id: 'community',
    name: '社区理解',
    sources: resolveSources('community', (input) =>
      renderPrompt(PROMPTS.communityRetrieve!.template, input.request.scope.publishedAt),
    ),

    async distill(material: RawMaterial, _input: DirectionInput): Promise<FeedbackPoint[]> {
      if (material.sourceId === 'llm') {
        return parseLLMPoints(String(material.data), 'community');
      }

      if (material.sourceId === 'zhihu_search') {
        const items = (material.data ?? []) as SearchItem[];
        return items
          .map((it, i) => ({
            kind: 'community' as const,
            text: (it.ContentText ?? it.Title ?? '').replace(/<\/?em>/g, ''),
            ref: i,
          }))
          .filter((p) => p.text.length > 0);
      }

      if (material.sourceId === 'zhihu_comment') {
        const items = (material.data ?? []) as CommentItem[];
        return items
          .map((it, i) => ({
            kind: 'community' as const,
            text: it.Content ?? '',
            ref: i,
          }))
          .filter((p) => p.text.length > 0);
      }

      return [];
    },
  });
}
