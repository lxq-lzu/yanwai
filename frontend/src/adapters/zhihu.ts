/**
 * 言外 · 知乎适配器
 *
 * 分层降级提取(见 02 文档 2.4):
 *   L1 结构化数据属性(data-zop 等 JSON 属性)→ 最精确
 *   L2 语义选择器(.AnswerItem / article / .QuestionHeader 等)
 *   L3 最近块级祖先启发式
 *   L4 兜底 —— 直接交给 generic.ts(registry 里排在本文件之后)
 *
 * 每层提取结果都带 hitLevel,纯调试/可观测性用途,不参与业务判断。
 * 这个文件删掉,registry.ts 去掉一项即可,页面自动退化到 generic 适配器,
 * core/adapters 其余代码不用改一行——这是模块化验收的关键场景之一。
 */

import type { SiteAdapter } from './types.js';
import type { Anchor, ExtractedContext, Scope, ScopeAuthor, Surrounding, CommentInfo } from '../core/types.js';

interface ZopData {
  type?: string;
  id?: string | number;
  authorName?: string;
  title?: string;
  publishedAt?: string | number;
}

function parseZop(el: Element | null): ZopData | null {
  const raw = el?.getAttribute('data-zop');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ZopData;
  } catch {
    return null;
  }
}

/**
 * 读取回答/评论的发布时间。梗/绰号/黑话的含义随发布时间漂移(同一词不同时期含义可能相反),
 * 所以发布时间必须随 scope/surroundings 一起进主链路。分层读取:
 *   L1 data-zop 的 publishedAt(demo 页与未来结构化数据)
 *   L2 meta[itemprop=datePublished] 的 content / datetime(知乎新版回答容器)
 *   L3 time[datetime](HTML 原生时间元素)
 *   L4 「发布于 X」「编辑于 X」文案兜底(知乎旧版)
 */
function detectPublishedAt(container: HTMLElement, zop: ZopData | null): string | number | undefined {
  if (zop?.publishedAt !== undefined && zop.publishedAt !== '') return zop.publishedAt;

  const meta = container.querySelector<HTMLElement>('[itemprop="datePublished"]');
  const metaTime = meta?.getAttribute('content') || meta?.getAttribute('datetime');
  if (metaTime) return metaTime;

  const timeEl = container.querySelector<HTMLElement>('time[datetime]');
  if (timeEl?.getAttribute('datetime')) return timeEl.getAttribute('datetime')!;

  const m = container.textContent?.match(
    /(?:发布于|编辑于)\s*([0-9]{4}-[0-9]{2}-[0-9]{2}(?:[ T][0-9:]+)?)/
  );
  if (m) return m[1];

  return undefined;
}

function computeAnchor(range: Range, exact: string): Anchor {
  const anchor: Anchor = { exact };
  try {
    const before = document.createRange();
    const container = range.startContainer.parentElement ?? range.startContainer;
    before.setStart(container, 0);
    before.setEnd(range.startContainer, range.startOffset);
    const beforeText = before.toString();
    if (beforeText) anchor.prefix = beforeText.slice(-32);
  } catch {
    // 取不到 prefix 就放弃,不影响 exact 匹配
  }
  try {
    const after = document.createRange();
    const container = range.endContainer.parentElement ?? range.endContainer;
    after.setStart(range.endContainer, range.endOffset);
    after.setEnd(container, container.childNodes.length);
    const afterText = after.toString();
    if (afterText) anchor.suffix = afterText.slice(0, 32);
  } catch {
    // 同上
  }
  return anchor;
}

/** 找到选区所属的回答/评论容器,分三层尝试 */
function findAnswerContainer(node: Node): { el: HTMLElement; hitLevel: string } | null {
  const start = node.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node.parentElement;
  if (!start) return null;

  // L1: 带 data-zop 的祖先
  const zopEl = start.closest<HTMLElement>('[data-zop]');
  if (zopEl) return { el: zopEl, hitLevel: 'L1' };

  // L2: 知乎常见语义类名/标签
  const semanticEl = start.closest<HTMLElement>('.AnswerItem, .Comment, article, .QuestionAnswer-content');
  if (semanticEl) return { el: semanticEl, hitLevel: 'L2' };

  // L3: 最近块级祖先启发式
  let el: HTMLElement | null = start;
  while (el) {
    const display = window.getComputedStyle(el).display;
    if (display === 'block' && el.textContent && el.textContent.trim().length > 20) {
      return { el, hitLevel: 'L3' };
    }
    el = el.parentElement;
  }

  return null;
}

function detectScope(container: HTMLElement): { kind: Scope['kind']; author?: ScopeAuthor } {
  const zop = parseZop(container);
  if (zop?.type === 'answer' || container.matches('.AnswerItem')) {
    const authorEl = container.querySelector<HTMLElement>('.AuthorInfo-name, .UserLink-link');
    return {
      kind: 'answer',
      author: zop?.authorName
        ? { name: zop.authorName }
        : authorEl?.textContent
        ? { name: authorEl.textContent.trim() }
        : undefined,
    };
  }
  if (zop?.type === 'comment' || container.matches('.Comment')) {
    return { kind: 'comment' };
  }
  if (container.closest('.QuestionHeader')) {
    return { kind: 'question' };
  }
  return { kind: 'answer' };
}

/**
 * 读取评论区(前端同源 DOM 抓取)。后端无法跨账号读任意回答评论,评论区是用户已展开的
 * DOM 内容,这里直接从页面读「评论」作为 c 层「位置·时间·评论」的资料。
 * 带 author(作者)与 url(可跳回),最多取 5 条控制上下文长度。
 */
function readCommentsFromDom(container?: HTMLElement): CommentInfo[] {
  const root: ParentNode = container ?? document;
  const els = Array.from(root.querySelectorAll<HTMLElement>('.Comment, .Comments .Comment, .CommentItem'));
  const out: CommentInfo[] = [];
  for (const el of els) {
    const authorEl = el.querySelector<HTMLElement>('.AuthorInfo-name, .UserLink-link, [itemprop="author"]');
    const contentEl = el.querySelector<HTMLElement>('.CommentContent, .RichText, [itemprop="text"]');
    const text = (contentEl?.textContent ?? el.textContent ?? '').trim().slice(0, 200);
    if (!text) continue;
    const link = el.querySelector<HTMLAnchorElement>('a[href]');
    out.push({
      text,
      author: authorEl?.textContent?.trim() || undefined,
      url: link?.href,
    });
    if (out.length >= 5) break;
  }
  return out;
}

function collectSurroundings(
  container: HTMLElement,
  kind: Scope['kind'],
  publishedAt?: string | number
): Surrounding[] {
  const surroundings: Surrounding[] = [];

  const titleEl = document.querySelector<HTMLElement>('.QuestionHeader-title, h1');
  if (titleEl?.textContent) {
    surroundings.push({ role: 'title', text: titleEl.textContent.trim() });
  }

  const containerText = container.textContent?.trim().slice(0, 1000);
  if (containerText) {
    surroundings.push({ role: 'container', text: containerText, publishedAt });
  }

  if (kind === 'answer') {
    // 取相邻的另一条高赞回答作为 sibling,补充社区语境
    const siblingItem = container.matches('.AnswerItem')
      ? (container.nextElementSibling as HTMLElement | null) ?? (container.previousElementSibling as HTMLElement | null)
      : null;
    if (siblingItem) {
      const siblingText = siblingItem.textContent?.trim().slice(0, 400);
      if (siblingText) {
        surroundings.push({ role: 'sibling', text: siblingText, weight: 0.6 });
      }
    }
  }

  return surroundings;
}

export const zhihuAdapter: SiteAdapter = {
  id: 'zhihu',

  matches(): boolean {
    return /zhihu\.com$/.test(location.hostname) || Boolean(document.querySelector('[data-zop]'));
  },

  extract(selection: Selection): ExtractedContext | null {
    const text = selection.toString().trim();
    if (text.length < 4 || text.length > 500) return null;
    if (selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    const found = findAnswerContainer(range.startContainer);
    if (!found) return null;

    const { kind, author } = detectScope(found.el);
    const zop = parseZop(found.el);
    const publishedAt = detectPublishedAt(found.el, zop);
    const surroundings = collectSurroundings(found.el, kind, publishedAt);
    const anchor = computeAnchor(range, text);
    const quoted = Boolean(
      (range.startContainer.nodeType === Node.ELEMENT_NODE ? (range.startContainer as HTMLElement) : range.startContainer.parentElement)?.closest(
        'blockquote'
      )
    );

    const id = zop?.id !== undefined ? String(zop.id) : found.el.id || location.href;

    const scope: Scope = {
      kind,
      id,
      author,
      quoted,
      publishedAt,
    };

    return {
      target: { text },
      surroundings,
      scope,
      anchor,
      hitLevel: found.hitLevel,
      comments: kind === 'answer' ? readCommentsFromDom(found.el) : undefined,
    };
  },

  readComments: () => readCommentsFromDom(),
};
