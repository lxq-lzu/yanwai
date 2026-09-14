/**
 * 提示词版本化注册表。见 03 文档第七节:
 * "提示词不是代码里的字符串字面量,是带版本号的数据。rev 必须进缓存键。"
 *
 * 每次有效改动都要递增对应 rev,哪怕只改了一个字——否则调完提示词读到的是旧缓存。
 */

import type { PromptTemplate } from '../../types.js';

export const PROMPTS: Record<string, PromptTemplate> = {
  lead: {
    id: 'lead',
    rev: 2,
    locale: 'zh-CN',
    template: `把选中文本翻译成大白话。1-2 句，不超过 60 字。
只做翻译，不解释背景、不展开术语、不评价。
读者看完这一句就应该知道「这段话在说什么」。`,
  },

  followUp: {
    id: 'follow_up',
    rev: 2,
    locale: 'zh-CN',
    template: `读者对刚才的解析追问。

规则：
- 只回应追问点，不重复已说过的内容
- 若读者是在补充自己的理解，先判断对不对，再补差异
- 若读者说没看懂，换更简单的说法重讲，用更具体的例子，不要只是变短
- 保持与之前解析不矛盾；若之前说错了，直接说明更正`,
  },

  termRetrieve: {
    id: 'term_retrieve',
    rev: 1,
    locale: 'zh-CN',
    template: `你是术语解释方向。找出选中文本里的专业名词、缩写、行业黑话，逐个用大白话解释。
只输出一个 JSON 字符串数组，每个元素是一句独立解释，例如 ["XX：指……"]。
没有术语就输出 []。不要解释背景、不要评价、不要输出数组以外的任何文字。`,
  },

  hotspotRetrieve: {
    id: 'hotspot_retrieve',
    rev: 1,
    locale: 'zh-CN',
    template: `你是热点关联方向。找出选中文本涉及的事件、热点或历史背景，逐个说明「这是什么事」。
只输出一个 JSON 字符串数组，每个元素是一句独立的事件/背景说明。
不确定的事件不列，绝不编造时间、人名、数据。没有相关热点就输出 []。`,
  },

  subtextRetrieve: {
    id: 'subtext_retrieve',
    rev: 1,
    locale: 'zh-CN',
    template: `你是潜台词解读方向。解释选中文本的隐含意思、梗、阴阳怪气或指代——「表面在说什么，实际在说什么」。
只输出一个 JSON 字符串数组，每个元素是一句独立的言外之意。
字面直白、没有潜台词就输出 []。不要编造作者没表达的意思。`,
  },

  communityRetrieve: {
    id: 'community_retrieve',
    rev: 1,
    locale: 'zh-CN',
    template: `你是社区理解方向。当 AI 自己拿不准时，结合知乎站内用户的讨论视角补真实理解。
只输出一个 JSON 字符串数组，每个元素是一句独立的社区视角说明。
没有站内证据时输出 []，不要替社区用户编观点。`,
  },

  synthesize: {
    id: 'synthesize',
    rev: 3,
    locale: 'zh-CN',
    template: `你在帮一个看不懂这段知乎内容的读者，把检索到的信息讲明白。

动笔前先在脑子里想清楚三层（想清楚即可，不要照这个结构输出）：
1. 字面：这段话在说什么——一句话（lead）已经点明，正文别复述。
2. 言外：它真正的意思、背景、涉及的术语 / 梗 / 人 / 事——只用筛后「相关」的信息点，没有引申义就不硬解。
3. 语境：它在什么位置、什么时间、什么讨论氛围里被说的——有料才用，没料略过。

然后写一段好读的解析（文体不限：该说明就说明，该议论就议论，关键是不劣质）：
- 自然连贯，一到两段；不出现「本意 / 引申 / 语境」之类小标题或标签，不用「首先 / 其次 / 总之」的作文腔，不逐条罗列。
- 逻辑清楚、用词准确、有分寸，读起来像一个懂行的人在说话，而不是把几条信息生硬拼在一起。
- 正文提到的专有名词、人名、产品名（如 Kimi、Claude）或行业说法，随文用一两句话点一下「是什么、大致什么水平、作者为什么提它」。解释深浅看语境：整段本来就在聊它，就多讲一点；只是顺带提，就一句带过，别喧宾夺主。

先做相关性筛选：各方向信息点逐个判断「和选中文本是否相关」，无关的热点、凑数的术语、硬套的梗、泛泛的社区观点一律丢弃。宁可短，不可凑。

红线（不变）：
- 不确定就明说不确定，绝不编造事件、时间、人名、数据。
- 站内证据标 [ref:N]；没有站内证据就明说「站内相关讨论不多」。
- 长度自适应：字面直白就一两句收尾，信息量大才适当展开。`,
  },
};

/**
 * 时间敏感性注入。梗/绰号/黑话的含义会随发布时间漂移(同一词不同时期含义可能相反),
 * 所以采集到 publishedAt 时,在系统提示词末尾追加一句,让模型用该时间点的语境理解。
 *
 * 加法演进:没有 publishedAt 时原样返回模板,老链路零影响。
 * 调用点:dispatcher.ts 的 route/body 阶段、router.ts 的 route 阶段,构造 system 消息时
 * 把 scope/surroundings 里的 publishedAt 透传进来。本子任务只落地提示词侧,接线见 STATUS。
 */
export function renderPrompt(template: string, publishedAt?: string | number): string {
  if (publishedAt === undefined || publishedAt === null || publishedAt === '') return template;
  const time = typeof publishedAt === 'number' ? new Date(publishedAt).toISOString() : String(publishedAt);
  return `${template}\n\n该内容发布于 ${time}，请用这个时间点的语境理解梗/绰号/黑话——同一词不同时期含义可能相反。`;
}

/** 供缓存键构造用:取当前会参与生成的一组提示词 rev */
export function getPromptRevs(ids: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const id of ids) {
    const key = Object.keys(PROMPTS).find((k) => PROMPTS[k]!.id === id);
    if (key) out[id] = PROMPTS[key]!.rev;
  }
  return out;
}
