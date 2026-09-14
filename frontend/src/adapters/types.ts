/**
 * 言外 · 站点适配器接口
 *
 * 唯一契约:`matches()` 判断当前页面是否归自己处理,`extract(selection)`
 * 把浏览器原生 Selection 翻译成 core 认识的 ExtractedContext(或 null 表示放弃)。
 *
 * core/selection.ts 只认识这个接口,不知道 zhihu.ts/generic.ts 内部怎么爬 DOM;
 * 新增一个站点适配器 = 新建一个实现这个接口的文件 + 在 registry.ts 里加一项,
 * 不用改 core 任何代码。删除一个适配器同理,只改 registry.ts 这一行。
 */

import type { ExtractedContext, CommentInfo } from '../core/types.js';

export interface SiteAdapter {
  /** 适配器标识,纯日志/调试用途 */
  id: string;
  /** 判断当前页面是否适用这个适配器 */
  matches(): boolean;
  /** 把浏览器 Selection 翻译成 ExtractedContext;拿不到有效上下文返回 null */
  extract(selection: Selection): ExtractedContext | null;
  /** 读取当前页面的评论(前端同源 DOM 抓取)。「相关评论」按钮 + c 层资料用;读不到返回 []。 */
  readComments?: () => CommentInfo[];
}
