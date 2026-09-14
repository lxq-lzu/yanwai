/**
 * 言外 · 前端持久化设置
 *
 * 「无限探索」「超长对话」「相关评论」三个开关的状态存 localStorage(网页 Demo)/ chrome.storage(插件),
 * 设置一次、下次沿用。见 11 文档主题三「交互控制」。
 *
 * 存储层对业务透明:网页/插件两套后端共用同一个异步接口;无 chrome 环境时回落 localStorage。
 */

export interface YanwaiSettings {
  /** 「无限探索」:true 时每次解析带「不限时」标记(跳过整体超时)。 */
  unlimited: boolean;
  /** 「超长对话」:true 时生成不限长(不追加字数约束、不传 maxTokens);false 时生成限长。 */
  longForm: boolean;
  /** 「相关评论」:true 时生成时把评论作为 c 层「评论」资料用进去;false 时不用。 */
  comments: boolean;
}

const STORAGE_KEY = 'yanwai.settings';
const DEFAULTS: YanwaiSettings = { unlimited: false, longForm: false, comments: false };

/** chrome.storage 的最小类型子集(项目不引 @types/chrome,这里用 globalThis 兜底声明)。 */
interface ChromeStorageLike {
  storage?: {
    local: {
      get(key: string): Promise<Record<string, unknown>>;
      set(items: Record<string, unknown>): Promise<void>;
    };
  };
}

function getChromeStorage(): ChromeStorageLike['storage'] | undefined {
  try {
    return (globalThis as { chrome?: ChromeStorageLike }).chrome?.storage;
  } catch {
    return undefined;
  }
}

async function readRaw(): Promise<Partial<YanwaiSettings>> {
  const storage = getChromeStorage()?.local;
  if (storage) {
    const got = await storage.get(STORAGE_KEY);
    return (got[STORAGE_KEY] as Partial<YanwaiSettings>) ?? {};
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<YanwaiSettings>) : {};
  } catch {
    return {};
  }
}

async function writeRaw(next: YanwaiSettings): Promise<void> {
  const storage = getChromeStorage()?.local;
  if (storage) {
    await storage.set({ [STORAGE_KEY]: next });
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 隐私模式等场景写失败静默忽略,不阻塞解析主流程
  }
}

let cache: YanwaiSettings = { ...DEFAULTS };

/** 同步读当前值。initSettings() 之前返回默认值。 */
export function getSettings(): YanwaiSettings {
  return cache;
}

/** 启动时拉一次持久化设置到内存缓存。 */
export async function initSettings(): Promise<void> {
  const raw = await readRaw();
  cache = { ...DEFAULTS, ...raw };
}

/** 更新单个开关并落盘。 */
export async function setSetting<K extends keyof YanwaiSettings>(
  key: K,
  value: YanwaiSettings[K]
): Promise<void> {
  cache = { ...cache, [key]: value };
  await writeRaw(cache);
}
