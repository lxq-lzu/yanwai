/**
 * hotspot 方向:热点关联。资料源链 = [zhihu_hot → zhihu_global → llm](config.directions 默认)。
 * distill 两种模式(见 10 文档第四节「hotspot → API 条目直接映射;LLM 兜底时直接产出 points」):
 *   - zhihu_hot / zhihu_global → API JSON 直接映射成 points(每个条目一个 event 点)
 *   - llm → 模型直接产出 points
 */

import type { Direction, DirectionInput, FeedbackPoint, RawMaterial } from '../../types.js';
import { PROMPTS, renderPrompt } from '../prompts/index.js';
import { createDirection, parseLLMPoints, resolveSources } from './shared.js';

interface HotListItem {
  Title?: string;
  Summary?: string;
}

interface GlobalItem {
  Title?: string;
  ContentText?: string;
}

export function createHotspotDirection(): Direction {
  return createDirection({
    id: 'hotspot',
    name: '热点关联',
    sources: resolveSources('hotspot', (input) =>
      renderPrompt(PROMPTS.hotspotRetrieve!.template, input.request.scope.publishedAt),
    ),

    async distill(material: RawMaterial, _input: DirectionInput): Promise<FeedbackPoint[]> {
      if (material.sourceId === 'llm') {
        return parseLLMPoints(String(material.data), 'event');
      }

      if (material.sourceId === 'zhihu_hot') {
        const items = (material.data ?? []) as HotListItem[];
        return items
          .map((it, i) => ({
            kind: 'event' as const,
            text: it.Summary ? `${it.Title}：${it.Summary}` : (it.Title ?? ''),
            ref: i,
          }))
          .filter((p) => p.text.length > 0);
      }

      if (material.sourceId === 'zhihu_global') {
        const items = (material.data ?? []) as GlobalItem[];
        return items
          .map((it, i) => ({
            kind: 'event' as const,
            text: (it.ContentText ?? it.Title ?? '').replace(/<\/?em>/g, ''),
            ref: i,
          }))
          .filter((p) => p.text.length > 0);
      }

      return [];
    },
  });
}
