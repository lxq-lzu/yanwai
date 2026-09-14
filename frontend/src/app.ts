/**
 * 言外 · 装配点(唯一知道所有模块存在的文件)
 *
 * 职责:实例化 adapter registry + selection watcher + client + session store + bubble,
 * 靠回调把它们接起来。除了这个文件,其余所有模块互相都不知道对方存在——
 * core/selection.ts 不知道 client.ts,client.ts 不知道 bubble.ts,bubble.ts 不知道
 * client.ts。删掉「相关评论」开关只需要在这个文件里去掉 onToggleComments 那一段,
 * 其余模块一行都不用改。
 *
 * requestSeq 防串台在这里落地(见 02 文档 5.1):session store 的 nextSeq()/isCurrent()
 * 由这个文件在每次发起请求前后调用,client.ts 本身保持无状态。
 */

import { pickAdapter } from './adapters/registry.js';
import { createSelectionWatcher } from './core/selection.js';
import { createExplainClient } from './core/client.js';
import { createExplainView } from './core/bubble.js';
import { createSessionStore } from './core/session.js';
import { initSettings, getSettings, setSetting } from './core/settings.js';
import type { ExplainView } from './core/bubble.js';
import type { StreamEvent } from './core/types.js';

export interface YanwaiAppOptions {
  /** 后端 baseUrl,留空则同源请求(网页 Demo 场景) */
  baseUrl?: string;
  /** 气泡挂载容器,默认 document.body */
  mount?: HTMLElement;
  accentColor?: string;
}

export interface YanwaiApp {
  destroy(): void;
}

const BUBBLE_GAP = 12;
const BUBBLE_WIDTH = 360;

function computeBubblePosition(rect: DOMRect): { top: number; left: number } {
  const scrollTop = window.scrollY;
  const scrollLeft = window.scrollX;
  const docTop = rect.top + scrollTop;
  const docLeft = rect.left + scrollLeft;
  const docRight = rect.right + scrollLeft;

  const spaceRight = window.innerWidth - rect.right;
  if (spaceRight >= BUBBLE_WIDTH + BUBBLE_GAP) {
    return { top: docTop, left: docRight + BUBBLE_GAP };
  }

  const spaceLeft = rect.left;
  if (spaceLeft >= BUBBLE_WIDTH + BUBBLE_GAP) {
    return { top: docTop, left: docLeft - BUBBLE_WIDTH - BUBBLE_GAP };
  }

  // 两侧空间都不够,退到选区下方,水平方向尽量不超出视口
  const left = Math.max(8, Math.min(docLeft, scrollLeft + window.innerWidth - BUBBLE_WIDTH - 8));
  return { top: rect.bottom + scrollTop + BUBBLE_GAP, left };
}

export function createYanwaiApp(options: YanwaiAppOptions = {}): YanwaiApp {
  const mount = options.mount ?? document.body;
  const client = createExplainClient({ baseUrl: options.baseUrl });
  const adapter = pickAdapter();

  // 持久化开关先拉一次到内存,之后 getSettings() 同步读
  void initSettings();

  let view: ExplainView | null = null;
  const activeHosts: HTMLElement[] = [];

  function closeView() {
    if (view) {
      view.destroy();
      const idx = activeHosts.indexOf(view.hostElement);
      if (idx !== -1) activeHosts.splice(idx, 1);
      view = null;
    }
  }

  const watcher = adapter
    ? createSelectionWatcher({
        adapter,
        ignoreHosts: activeHosts,
        onSelect: (snapshot) => {
          closeView();

          const session = createSessionStore();
          const position = computeBubblePosition(snapshot.rect);

          const newView = createExplainView({
            mount,
            theme: { accentColor: options.accentColor },
            position,
            unlimited: getSettings().unlimited,
            longForm: getSettings().longForm,
            comments: getSettings().comments,
            onToggleUnlimited: (enabled) => {
              void setSetting('unlimited', enabled);
            },
            onToggleLongForm: (enabled) => {
              void setSetting('longForm', enabled);
            },
            onToggleComments: (enabled) => {
              void setSetting('comments', enabled);
            },
            onClose: closeView,
            onReangle: () => {
              const sessionId = session.getSessionId();
              if (!sessionId) return;
              const seq = session.nextSeq();
              newView.reset({ clearLead: false });
              void client.reangle(sessionId, {
                onEvent: (e) => guardedFeed(session, seq, newView, e),
              });
            },
            onFollowUp: (message: string) => {
              const sessionId = session.getSessionId();
              if (!sessionId) return;
              const seq = session.nextSeq();
              newView.reset({ clearLead: false });
              void client.followup(sessionId, message, {
                onEvent: (e) => guardedFeed(session, seq, newView, e),
              });
            },
          });

          view = newView;
          activeHosts.push(newView.hostElement);

          // 「相关评论」开关控制评论是否作为 c 层资料参与生成:开才展示 + 随请求带后端,关则不带
          const commentsEnabled = getSettings().comments;
          if (commentsEnabled && snapshot.ctx.comments?.length) {
            newView.feedComments(snapshot.ctx.comments);
          }

          const ctx = commentsEnabled
            ? snapshot.ctx
            : { ...snapshot.ctx, comments: undefined };

          const seq = session.nextSeq();
          void client.explain(
            ctx,
            {
              onEvent: (e) => guardedFeed(session, seq, newView, e),
            },
            { unlimited: getSettings().unlimited, longForm: getSettings().longForm }
          );
        },
      })
    : null;

  function guardedFeed(
    session: ReturnType<typeof createSessionStore>,
    seq: number,
    targetView: ExplainView,
    event: StreamEvent
  ) {
    // 防串台:只有仍是"当前这一轮"的事件才喂给气泡,过期事件直接丢弃(见 02 文档 5.1)
    if (!session.isCurrent(seq)) return;
    if (event.t === 'start' && 'seq' in event) {
      // 后端 seq 仅用于其自身日志/调试,前端串台判断完全依赖 session store 的本地 seq
    }
    if (event.t === 'done' && event.sessionId) {
      session.setSessionId(event.sessionId);
    }
    targetView.feed(event);
  }

  return {
    destroy() {
      watcher?.destroy();
      closeView();
    },
  };
}
