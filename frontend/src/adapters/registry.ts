/**
 * 言外 · 适配器注册表
 *
 * 唯一职责:按优先级列出所有 SiteAdapter,供 app.ts 取第一个 matches() 为真的使用。
 * 这是"可插拔"约束的核心体现:新增/删除一个适配器只改这一个文件里的数组,
 * core 和其余适配器完全不用感知。
 *
 * 顺序很重要:zhihuAdapter 排在 genericAdapter 前面,因为 genericAdapter.matches()
 * 永远返回 true(兜底),必须排最后。
 */

import type { SiteAdapter } from './types.js';
import { zhihuAdapter } from './zhihu.js';
import { genericAdapter } from './generic.js';

export const adapterRegistry: SiteAdapter[] = [zhihuAdapter, genericAdapter];

/** 取第一个 matches() 为真的适配器;registry 非空且末项兜底为 true,理论上总有命中 */
export function pickAdapter(registry: SiteAdapter[] = adapterRegistry): SiteAdapter | null {
  for (const adapter of registry) {
    if (adapter.matches()) return adapter;
  }
  return null;
}
