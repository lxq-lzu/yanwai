/**
 * 言外 · 气泡渲染器
 *
 * 纯事件消费者(见 02 文档 8.1):
 *   createExplainView({ mount, theme }) → { feed(event), reset(), destroy() }
 *
 * 只吃 StreamEvent,不知道请求怎么发的、不知道站点是什么、不知道选区在哪。
 * 用户交互(换个角度/追问/读评论)通过 props 回调上抛给调用方,自己绝不发请求——
 * 这样网页 Demo、浏览器插件、未来任何宿主环境可以共用这一份,替换 client.ts
 * 或 selection.ts 都不需要动这个文件。
 *
 * 用 Shadow DOM 隔离样式(注入宿主页面时,宿主全局 CSS 不能污染气泡)。
 */

import type { StreamEvent, RefItem, CommentInfo } from './types.js';
import { renderMarkdown } from './markdown.js';

export interface ExplainViewTheme {
  accentColor?: string;
}

export interface ExplainViewOptions {
  /** 气泡挂载的宿主容器(通常是 document.body 或一个绝对定位的包装 div) */
  mount: HTMLElement;
  theme?: ExplainViewTheme;
  /** 定位:相对 mount 的坐标,单位 px。不传则由调用方后续通过 setPosition 设置 */
  position?: { top: number; left: number };
  onReangle?: () => void;
  onFollowUp?: (message: string) => void;
  /** 「无限探索」开关被点:enabled = 新状态(开=不限时) */
  onToggleUnlimited?: (enabled: boolean) => void;
  /** 「超长对话」开关被点:enabled = 新状态(开=生成不限长) */
  onToggleLongForm?: (enabled: boolean) => void;
  /** 「相关评论」开关被点:enabled = 新状态(开=生成时用评论) */
  onToggleComments?: (enabled: boolean) => void;
  /** 「无限探索」初始态(持久化开关) */
  unlimited?: boolean;
  /** 「超长对话」初始态(持久化开关) */
  longForm?: boolean;
  /** 「相关评论」初始态(持久化开关) */
  comments?: boolean;
  onClose?: () => void;
}

export interface ExplainView {
  feed(event: StreamEvent): void;
  feedComments(snippets: CommentInfo[]): void;
  /** 清空正文/refs/error 准备接收新一轮事件。默认连"一句话"也清空(首次划词场景);
   * 传 { clearLead: false } 只清正文,保留已有的"一句话"——换个角度/追问都不会重发
   * lead_delta,清掉它会导致那句"一句话"永久消失(见 02 文档 F2 修复记录)。 */
  reset(options?: { clearLead?: boolean }): void;
  setPosition(pos: { top: number; left: number }): void;
  destroy(): void;
  /** Shadow DOM 内事件会被 composedPath 重定向,暴露宿主元素方便调用方判断"点击是否来自气泡内部" */
  hostElement: HTMLElement;
}

const STYLE = `
:host { all: initial; }
.bubble {
  position: absolute;
  box-sizing: border-box;
  width: 360px;
  max-width: min(360px, 90vw);
  background: #ffffff;
  color: #1a1a1a;
  border-radius: 12px;
  box-shadow: 0 4px 24px rgba(0,0,0,0.12), 0 0 1px rgba(0,0,0,0.08);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  font-size: 14px;
  line-height: 1.6;
  z-index: 2147483647;
  overflow: hidden;
}
/* 顶部拖拽短横线(抽屉把手):只有按住它才拖动,正文/一句话/注释区可正常选中复制 */
.drag-handle {
  position: absolute;
  top: 5px;
  left: 50%;
  transform: translateX(-50%);
  width: 36px;
  height: 4px;
  border-radius: 2px;
  background: #ddd;
  cursor: grab;
  touch-action: none;
  z-index: 3;
}
.drag-handle.dragging { cursor: grabbing; }
.resize-handle {
  position: absolute;
  right: 0;
  bottom: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  z-index: 2;
  touch-action: none;
}
.resize-handle::after {
  content: '';
  position: absolute;
  right: 3px;
  bottom: 3px;
  width: 8px;
  height: 8px;
  border-right: 2px solid #ccc;
  border-bottom: 2px solid #ccc;
}
.section { padding: 12px 16px; }
.section + .section { border-top: 1px solid #f0f0f0; }
.lead { font-weight: 500; color: #1a1a1a; }
.body { color: #333; word-break: break-word; }
.body h1 { font-size: 16px; font-weight: 600; margin: 8px 0 4px; }
.body h2 { font-size: 15px; font-weight: 600; margin: 8px 0 4px; }
.body p { margin: 6px 0; }
.body ul { margin: 6px 0; padding-left: 20px; }
.body li { margin: 2px 0; }
.body blockquote { margin: 6px 0; padding: 2px 12px; border-left: 3px solid #e0e0e0; color: #666; }
.body code { font-family: "SF Mono", Consolas, "Liberation Mono", monospace; font-size: 13px; background: #f5f5f5; padding: 1px 4px; border-radius: 3px; }
.body a { color: var(--accent, #0084FF); text-decoration: none; }
.body strong { font-weight: 600; }
.skeleton { color: #bbb; }
.error { padding: 8px 16px; font-size: 12px; color: #d33; }
/* 四按钮同排:长方形框 + 淡蓝背景 + 四字统一 */
.actions { display: flex; gap: 6px; padding: 8px 16px; border-top: 1px solid #f0f0f0; }
.actions button {
  flex: 1 1 0;
  min-width: 0;
  border: 1px solid #cfe4ff;
  background: #eef6ff;
  color: #1a6fd1;
  font-size: 12px;
  cursor: pointer;
  padding: 6px 2px;
  border-radius: 6px;
  white-space: nowrap;
}
.actions button:hover { background: #dcecff; }
.actions button.active { background: #cfe4ff; border-color: #86b9f0; color: #0b5cad; font-weight: 500; }
/* 注释(引用来源 + 相关评论)默认折叠,展开后在浮窗内滚动,不撑高浮窗 */
.notes { border-top: 1px solid #f0f0f0; }
.notes-toggle {
  display: block;
  width: 100%;
  border: none;
  background: none;
  color: #888;
  font-size: 12px;
  cursor: pointer;
  padding: 6px 16px;
  text-align: left;
}
.notes-toggle:hover { color: var(--accent, #0084FF); }
.notes-content {
  display: none;
  max-height: 160px;
  overflow-y: auto;
  padding: 0 16px 8px;
  font-size: 12px;
  color: #888;
}
.notes.open .notes-content { display: block; }
.notes .ref-item { margin-top: 4px; cursor: pointer; }
.notes .ref-item:hover { color: var(--accent, #0084FF); }
.notes .note-item { margin-top: 4px; }
.notes .note-item a { color: inherit; text-decoration: underline; }
.notes .note-item a:hover { color: var(--accent, #0084FF); }
.followup { display: flex; gap: 6px; padding: 8px 16px; border-top: 1px solid #f0f0f0; }
.followup input {
  flex: 1;
  border: 1px solid #e0e0e0;
  border-radius: 6px;
  padding: 6px 10px;
  font-size: 13px;
  outline: none;
}
.followup input:focus { border-color: var(--accent, #0084FF); }
.followup button {
  border: none;
  background: var(--accent, #0084FF);
  color: #fff;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
}
.followup button:disabled { opacity: 0.5; cursor: default; }
.close-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  border: none;
  background: none;
  color: #999;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  padding: 2px 6px;
}
.close-btn:hover { color: #333; }
`;

export function createExplainView(options: ExplainViewOptions): ExplainView {
  const host = document.createElement('div');
  host.style.position = 'absolute';
  host.style.top = `${options.position?.top ?? 0}px`;
  host.style.left = `${options.position?.left ?? 0}px`;
  options.mount.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const styleEl = document.createElement('style');
  styleEl.textContent = STYLE;
  shadow.appendChild(styleEl);

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (options.theme?.accentColor) {
    bubble.style.setProperty('--accent', options.theme.accentColor);
  }
  shadow.appendChild(bubble);

  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-btn';
  closeBtn.textContent = '×';
  closeBtn.setAttribute('aria-label', '关闭');
  closeBtn.addEventListener('click', () => options.onClose?.());
  bubble.appendChild(closeBtn);

  const leadSection = document.createElement('div');
  leadSection.className = 'section lead';
  leadSection.textContent = '';
  bubble.appendChild(leadSection);

  const bodySection = document.createElement('div');
  bodySection.className = 'section body skeleton';
  bodySection.textContent = '正在生成…';
  bubble.appendChild(bodySection);

  const errorSection = document.createElement('div');
  errorSection.className = 'error';
  errorSection.style.display = 'none';
  bubble.appendChild(errorSection);

  // —— 注释区(引用来源 + 相关评论)默认折叠,展开后在浮窗内滚动 ——
  const notesSection = document.createElement('div');
  notesSection.className = 'notes';
  notesSection.style.display = 'none';
  const notesToggle = document.createElement('button');
  notesToggle.className = 'notes-toggle';
  const notesContent = document.createElement('div');
  notesContent.className = 'notes-content';
  notesSection.appendChild(notesToggle);
  notesSection.appendChild(notesContent);
  bubble.appendChild(notesSection);

  const actions = document.createElement('div');
  actions.className = 'actions';
  bubble.appendChild(actions);

  // 四按钮同排:重新解析 / 相关评论 / 无限探索 / 超长对话
  const reangleBtn = document.createElement('button');
  reangleBtn.textContent = '重新解析';
  reangleBtn.addEventListener('click', () => options.onReangle?.());
  if (options.onReangle) actions.appendChild(reangleBtn);

  const commentsBtn = document.createElement('button');
  commentsBtn.textContent = '相关评论';
  commentsBtn.addEventListener('click', () => {
    const next = !commentsBtn.classList.contains('active');
    commentsBtn.classList.toggle('active', next);
    options.onToggleComments?.(next);
  });
  if (options.onToggleComments) {
    commentsBtn.classList.toggle('active', !!options.comments);
    actions.appendChild(commentsBtn);
  }

  const unlimitedBtn = document.createElement('button');
  unlimitedBtn.textContent = '无限探索';
  unlimitedBtn.addEventListener('click', () => {
    const next = !unlimitedBtn.classList.contains('active');
    unlimitedBtn.classList.toggle('active', next);
    options.onToggleUnlimited?.(next);
  });
  if (options.onToggleUnlimited) {
    unlimitedBtn.classList.toggle('active', !!options.unlimited);
    actions.appendChild(unlimitedBtn);
  }

  const longFormBtn = document.createElement('button');
  longFormBtn.textContent = '超长对话';
  longFormBtn.addEventListener('click', () => {
    const next = !longFormBtn.classList.contains('active');
    longFormBtn.classList.toggle('active', next);
    options.onToggleLongForm?.(next);
  });
  if (options.onToggleLongForm) {
    longFormBtn.classList.toggle('active', !!options.longForm);
    actions.appendChild(longFormBtn);
  }

  const followupRow = document.createElement('div');
  followupRow.className = 'followup';
  const followupInput = document.createElement('input');
  followupInput.type = 'text';
  followupInput.placeholder = '还有不懂的？追问一下…';
  followupInput.maxLength = 500;
  const followupBtn = document.createElement('button');
  followupBtn.textContent = '发送';
  followupRow.appendChild(followupInput);
  followupRow.appendChild(followupBtn);
  if (options.onFollowUp) bubble.appendChild(followupRow);

  function submitFollowUp() {
    const text = followupInput.value.trim();
    if (!text) return;
    options.onFollowUp?.(text);
    followupInput.value = '';
  }
  followupBtn.addEventListener('click', submitFollowUp);
  followupInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitFollowUp();
  });

  // —— 顶部拖拽短横线:只有按住它才能拖动浮窗(正文/一句话/注释区可正常选中复制) ——
  const dragHandle = document.createElement('div');
  dragHandle.className = 'drag-handle';
  dragHandle.setAttribute('aria-label', '拖动气泡');
  bubble.appendChild(dragHandle);

  let dragState: { startX: number; startY: number; startTop: number; startLeft: number } | null = null;

  dragHandle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      startTop: parseFloat(host.style.top) || 0,
      startLeft: parseFloat(host.style.left) || 0,
    };
    dragHandle.classList.add('dragging');
    dragHandle.setPointerCapture(e.pointerId);
  });

  dragHandle.addEventListener('pointermove', (e) => {
    if (!dragState) return;
    host.style.top = `${dragState.startTop + (e.clientY - dragState.startY)}px`;
    host.style.left = `${dragState.startLeft + (e.clientX - dragState.startX)}px`;
  });

  function endDrag(e: PointerEvent) {
    if (!dragState) return;
    dragState = null;
    dragHandle.classList.remove('dragging');
    if (dragHandle.hasPointerCapture(e.pointerId)) dragHandle.releasePointerCapture(e.pointerId);
  }
  dragHandle.addEventListener('pointerup', endDrag);
  dragHandle.addEventListener('pointercancel', endDrag);

  // —— 等比缩放:右下角手柄拖动,保持宽高比 ——
  const MIN_WIDTH = 200;
  const MIN_HEIGHT = 120;

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'resize-handle';
  resizeHandle.setAttribute('aria-label', '缩放气泡');
  bubble.appendChild(resizeHandle);

  let resizeState: { startX: number; startY: number; startWidth: number; startHeight: number } | null = null;

  resizeHandle.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const rect = bubble.getBoundingClientRect();
    resizeState = {
      startX: e.clientX,
      startY: e.clientY,
      startWidth: rect.width,
      startHeight: rect.height,
    };
    resizeHandle.setPointerCapture(e.pointerId);
  });

  resizeHandle.addEventListener('pointermove', (e) => {
    if (!resizeState) return;
    const dx = e.clientX - resizeState.startX;
    const dy = e.clientY - resizeState.startY;
    const ratio = resizeState.startWidth / resizeState.startHeight;
    let width = resizeState.startWidth;
    let height = resizeState.startHeight;
    // 取变化更明显的一轴为主,另一轴按比例跟随(改宽高跟改、改长宽跟改)
    if (Math.abs(dx) >= Math.abs(dy)) {
      width = Math.max(MIN_WIDTH, resizeState.startWidth + dx);
      height = width / ratio;
    } else {
      height = Math.max(MIN_HEIGHT, resizeState.startHeight + dy);
      width = height * ratio;
    }
    // 撑开 max-width 限制,允许等比放大到超过初始 360px
    bubble.style.maxWidth = 'none';
    bubble.style.width = `${width}px`;
    bubble.style.height = `${height}px`;
  });

  function endResize(e: PointerEvent) {
    if (!resizeState) return;
    resizeState = null;
    if (resizeHandle.hasPointerCapture(e.pointerId)) resizeHandle.releasePointerCapture(e.pointerId);
  }
  resizeHandle.addEventListener('pointerup', endResize);
  resizeHandle.addEventListener('pointercancel', endResize);

  let bodyStarted = false;
  let leadStarted = false;
  let bodyBuffer = '';

  // —— 注释区状态(引用来源 + 相关评论) ——
  let refsItems: RefItem[] = [];
  let commentItems: CommentInfo[] = [];
  let notesExpanded = false;

  function renderNotes(): void {
    const total = refsItems.length + commentItems.length;
    if (total === 0) {
      notesSection.style.display = 'none';
      notesExpanded = false;
      notesSection.classList.remove('open');
      notesContent.innerHTML = '';
      return;
    }
    notesSection.style.display = 'block';
    notesSection.classList.toggle('open', notesExpanded);
    notesToggle.textContent = notesExpanded ? `收起注释（${total}）` : `展开注释（${total}）`;

    notesContent.innerHTML = '';
    for (const item of refsItems) {
      const el = document.createElement('div');
      el.className = 'ref-item';
      el.textContent = `[${item.n}] ${item.quote}${item.author ? `（${item.author}）` : ''}`;
      notesContent.appendChild(el);
    }
    for (const s of commentItems) {
      const el = document.createElement('div');
      el.className = 'note-item';
      const label = `${s.text}${s.author ? `（${s.author}）` : ''}`;
      if (s.url) {
        const a = document.createElement('a');
        a.href = s.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = label;
        el.appendChild(a);
      } else {
        el.textContent = label;
      }
      notesContent.appendChild(el);
    }
  }
  notesToggle.addEventListener('click', () => {
    notesExpanded = !notesExpanded;
    renderNotes();
  });

  function feed(event: StreamEvent): void {
    switch (event.t) {
      case 'start':
        // 新一轮开始,清掉上一轮残留(reangle/followup 复用同一个气泡时会走到这里)
        break;
      case 'lead_delta':
        if (!leadStarted) {
          leadStarted = true;
          leadSection.textContent = '';
        }
        leadSection.textContent += event.d;
        break;
      case 'lead_end':
        break;
      case 'directions':
        // 命中方向摘要(供调试/后台展示),当前前端忽略,不渲染
        break;
      case 'body_delta':
        if (!bodyStarted) {
          bodyStarted = true;
          bodySection.classList.remove('skeleton');
          bodySection.textContent = '';
        }
        bodyBuffer += event.d;
        // 流式期间继续用 textContent 显示纯文本,保留打字机反馈;
        // body_end 时再统一转 markdown 渲染,避免 delta 截断破坏标记
        bodySection.textContent += event.d;
        break;
      case 'refs':
        refsItems = event.items;
        renderNotes();
        break;
      case 'body_end':
        bodySection.classList.remove('skeleton');
        if (bodyStarted) {
          const finalText = event.body !== undefined ? event.body : bodyBuffer;
          bodySection.innerHTML = renderMarkdown(finalText);
        } else {
          bodySection.textContent = '';
        }
        break;
      case 'error':
        errorSection.style.display = 'block';
        errorSection.textContent = friendlyErrorMessage(event.msg);
        if (!bodyStarted) bodySection.style.display = 'none';
        break;
      case 'done':
        break;
      default:
        // 未知事件类型,按协议要求忽略(只允许加法演进)
        break;
    }
  }

  /**
 * 把内部错误码/调试字符串翻译成用户能看懂的话(见 02 文档 F5 修复记录)。
 * client.ts 合成的 `request_failed_404` 之类的字符串,以及后端 stage 失败时
 * 留下的英文调试信息("lead generation failed" 等),都不应该原样展示给用户。
 */
function friendlyErrorMessage(msg: string): string {
  if (msg === 'request_failed_404') return '会话已过期，请重新划词提问';
  if (msg === 'request_failed_429') return '请求太频繁，请稍后再试';
  if (msg.startsWith('request_failed_')) return '请求失败，请稍后再试';
  return '生成失败，请稍后再试';
}

function feedComments(snippets: CommentInfo[]): void {
    // 重复点「相关评论」时整体替换,不叠加(见 02 文档 F3 修复记录)
    commentItems = snippets;
    renderNotes();
  }

  function reset(options?: { clearLead?: boolean }): void {
    const clearLead = options?.clearLead ?? true;
    if (clearLead) {
      leadStarted = false;
      leadSection.textContent = '';
    }
    bodyStarted = false;
    bodyBuffer = '';
    bodySection.textContent = '正在生成…';
    bodySection.classList.add('skeleton');
    bodySection.style.display = '';
    refsItems = [];
    commentItems = [];
    notesExpanded = false;
    renderNotes();
    errorSection.style.display = 'none';
    errorSection.textContent = '';
  }

  function setPosition(pos: { top: number; left: number }): void {
    host.style.top = `${pos.top}px`;
    host.style.left = `${pos.left}px`;
  }

  function destroy(): void {
    host.remove();
  }

  return { feed, feedComments, reset, setPosition, destroy, hostElement: host };
}
