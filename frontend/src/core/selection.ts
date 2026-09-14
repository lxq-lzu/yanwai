/**
 * 言外 · 划词监听
 *
 * 唯一职责:监听 mouseup,防抖 + 过滤 + 去重之后,把选区交给传入的 SiteAdapter
 * 提取成 ExtractedContext,通过 onSelect 回调交给调用方——自己不渲染、不发请求,
 * 不知道 client.ts/bubble.ts 存在。
 *
 * 关键设计(见 02 文档 5.2/5.3):
 * - mouseup 防抖 300ms,防止拖选过程中连续触发
 * - 长度门槛 4~500 字,过滤纯数字/URL/标点(粗略正则)
 * - 跳过 input/textarea/contenteditable 内的选区(那是用户在编辑,不是在划词提问)
 * - 60 秒内相同文本 hash 去重,避免同一段话来回选中反复触发请求
 * - 选区在 mouseup 时就地做快照(text/rect),后续气泡内点击导致 window.getSelection()
 *   被清空也不影响——所有下游逻辑只读快照,不重新读取 live selection
 * - 用 composedPath() 判断"这次 mouseup 是否发生在气泡宿主元素内部",避免气泡自己的
   文本被当成新选区触发(Shadow DOM 会把事件目标重定向成 host,composedPath 才能看到真实路径)
 */

import type { SiteAdapter } from '../adapters/types.js';
import type { ExtractedContext } from './types.js';

export interface SelectionSnapshot {
  ctx: ExtractedContext;
  /** mouseup 时选区的边界矩形,用于气泡定位;后续 live selection 失效也不受影响 */
  rect: DOMRect;
}

export interface SelectionWatcherOptions {
  adapter: SiteAdapter;
  onSelect: (snapshot: SelectionSnapshot) => void;
  debounceMs?: number;
  minLen?: number;
  maxLen?: number;
  /** 划词事件发生时,如果 composedPath 里包含这些宿主元素之一,则忽略(气泡自身内部的选区) */
  ignoreHosts?: HTMLElement[];
}

export interface SelectionWatcher {
  destroy(): void;
}

const DEDUPE_WINDOW_MS = 60_000;
const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA']);

/**
 * 在派发的 mouseup 事件对象上把这个属性设为 true,可以让这次选区跳过 60 秒去重
 * (但仍然要过长度/可编辑态过滤)。去重是为了防止拖选/误触反复触发,不该拦截
 * 用户主动点击——比如「精选示例」按钮连点两次,第二次也应该正常触发(见 F6 修复记录)。
 */
export const BYPASS_DEDUPE_FLAG = '__yanwaiBypassDedupe';

function isEditableTarget(node: EventTarget | null): boolean {
  if (!(node instanceof HTMLElement)) return false;
  if (EDITABLE_TAGS.has(node.tagName)) return true;
  return node.isContentEditable;
}

function isMostlyPunctuationOrUrl(text: string): boolean {
  const stripped = text.replace(/[\s\p{P}\p{S}0-9]/gu, '');
  return stripped.length === 0;
}

/** 简单可复现的字符串 hash,只用于去重,不需要密码学强度 */
function hashText(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (h * 31 + text.charCodeAt(i)) | 0;
  }
  return String(h);
}

export function createSelectionWatcher(options: SelectionWatcherOptions): SelectionWatcher {
  const debounceMs = options.debounceMs ?? 300;
  const minLen = options.minLen ?? 4;
  const maxLen = options.maxLen ?? 500;

  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  const recentHashes = new Map<string, number>();

  function isInsideIgnoredHost(e: MouseEvent): boolean {
    const path = e.composedPath();
    return (options.ignoreHosts ?? []).some((host) => path.includes(host));
  }

  function pruneDedupe(now: number) {
    for (const [hash, ts] of recentHashes) {
      if (now - ts > DEDUPE_WINDOW_MS) recentHashes.delete(hash);
    }
  }

  function handleMouseUp(e: MouseEvent) {
    if (isEditableTarget(e.target)) return;
    if (isInsideIgnoredHost(e)) return;

    const bypassDedupe = (e as unknown as Record<string, unknown>)[BYPASS_DEDUPE_FLAG] === true;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      processSelection(bypassDedupe);
    }, debounceMs);
  }

  function processSelection(bypassDedupe = false) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;

    const text = selection.toString().trim();
    if (text.length < minLen || text.length > maxLen) return;
    if (isMostlyPunctuationOrUrl(text)) return;

    const now = Date.now();
    pruneDedupe(now);
    const hash = hashText(text);
    const last = recentHashes.get(hash);
    if (!bypassDedupe && last !== undefined && now - last < DEDUPE_WINDOW_MS) return;

    if (!options.adapter.matches()) return;
    const ctx = options.adapter.extract(selection);
    if (!ctx) return;

    // rect 必须在这里(mouseup 后同步)取,之后 selection 可能因用户点击气泡而清空
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    recentHashes.set(hash, now);
    options.onSelect({ ctx, rect });
  }

  document.addEventListener('mouseup', handleMouseUp, true);

  return {
    destroy() {
      document.removeEventListener('mouseup', handleMouseUp, true);
      if (debounceTimer) clearTimeout(debounceTimer);
      recentHashes.clear();
    },
  };
}
