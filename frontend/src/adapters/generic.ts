/**
 * 言外 · 通用兜底适配器(L4)
 *
 * 不认识任何站点结构,只用浏览器标准 Selection/Range API 提取最基本的上下文:
 * 选中文本本身 + 紧邻的 prefix/suffix(用于 Anchor 定位)+ 页面标题当 title。
 * 是 registry.ts 里排最后的兜底项——只要 zhihu.ts 等更精确的适配器都
 * `matches()` 为 false,就轮到它接管,保证"随便一个网页也能用起来"。
 *
 * 删除这个文件 = 在 registry.ts 里去掉它 + 接受"不认识的站点直接不出气泡"这个后果,
 * 不影响 zhihu.ts 或 core 任何代码。
 */

import type { SiteAdapter } from './types.js';
import type { Anchor, ExtractedContext, Surrounding } from '../core/types.js';

const ANCHOR_CONTEXT_LEN = 32;

function computeAnchor(range: Range, exact: string): Anchor {
  const anchor: Anchor = { exact };

  const before = document.createRange();
  before.setStart(range.startContainer.ownerDocument?.body ?? range.startContainer, 0);
  try {
    before.setEnd(range.startContainer, range.startOffset);
    const beforeText = before.toString();
    if (beforeText) anchor.prefix = beforeText.slice(-ANCHOR_CONTEXT_LEN);
  } catch {
    // 跨节点边界计算失败时静默放弃 prefix,不影响主流程
  }

  try {
    const after = range.cloneRange();
    after.collapse(false);
    const afterProbe = document.createRange();
    afterProbe.setStart(range.endContainer, range.endOffset);
    const parent = range.endContainer.parentElement ?? range.endContainer;
    afterProbe.setEnd(parent, parent.childNodes.length);
    const afterText = afterProbe.toString();
    if (afterText) anchor.suffix = afterText.slice(0, ANCHOR_CONTEXT_LEN);
  } catch {
    // 同上,suffix 拿不到就算了,Anchor.exact 仍然可用
  }

  return anchor;
}

function nearestBlockAncestor(node: Node): HTMLElement | null {
  let el: HTMLElement | null = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  while (el) {
    const display = window.getComputedStyle(el).display;
    if (display === 'block' || display === 'list-item' || /^(P|DIV|ARTICLE|SECTION|LI|BLOCKQUOTE)$/.test(el.tagName)) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

export const genericAdapter: SiteAdapter = {
  id: 'generic',

  matches(): boolean {
    // 兜底适配器,永远认为自己适用;registry 顺序保证它排最后才被轮到
    return true;
  },

  extract(selection: Selection): ExtractedContext | null {
    const text = selection.toString().trim();
    if (text.length < 4 || text.length > 500) return null;
    if (selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    const anchor = computeAnchor(range, text);

    const block = nearestBlockAncestor(range.startContainer);
    const surroundings: Surrounding[] = [];
    if (document.title) {
      surroundings.push({ role: 'title', text: document.title });
    }
    if (block) {
      const containerText = block.textContent?.trim().slice(0, 800);
      if (containerText) surroundings.push({ role: 'container', text: containerText });
    }

    const quoted = Boolean(block?.closest('blockquote'));

    return {
      target: { text },
      surroundings,
      scope: {
        kind: 'answer',
        id: location.href,
        quoted,
      },
      anchor,
      hitLevel: 'L4',
    };
  },

  readComments: () => [],
};
