/**
 * [ref:N] 提取、校验与按出现顺序重编号。见 02 文档 3.5:
 * "N 必须 ≤ 实际证据数组长度,越界直接剥掉,防止模型编出不存在的引用编号。"
 * 重编号规则(裸方括号 [1]、从 1 起、按正文出现顺序):第一次出现的合法 [ref:N]
 * 分配下一个新编号(1、2、3…),重复出现复用首次编号;正文里 [ref:N] 全部替换成 [新编号]。
 */

import type { Source, RefItem } from '../types.js';

const REF_RE = /\[ref:(\d+)\]/g;

/**
 * 从正文文本中提取出现的所有 [ref:N],过滤掉越界的编号,并按正文出现顺序重编号为
 * 裸方括号 [1]、[2]、[3]…。返回 { cleanedText, refs }:
 * - cleanedText:正文里合法 [ref:N] 已替换成 [新编号],越界引用被剥除(替换为空);
 * - refs:按新编号升序(即首次出现顺序),RefItem.n 用新编号,quote/author/url 取自对应源。
 *
 * N 对应综合器收到的站内来源扁平数组(见 dispatcher.flattenSources)的下标 + 1。
 */
export function extractAndValidateRefs(
  text: string,
  sources: Source[]
): { cleanedText: string; refs: RefItem[] } {
  // 原始 N → 新编号(按首次出现顺序 1 起)
  const renumber = new Map<number, number>();
  const refs: RefItem[] = [];

  const cleanedText = text.replace(REF_RE, (match, numStr) => {
    const n = Number(numStr);
    if (n < 1 || n > sources.length) return ''; // 越界引用剥掉,不展示给用户

    let newN = renumber.get(n);
    if (newN === undefined) {
      newN = renumber.size + 1; // 第一次出现,分配下一个新编号
      renumber.set(n, newN);
      const source = sources[n - 1]!;
      refs.push({
        n: newN,
        quote: source.text,
        author: source.author,
        url: source.url,
      });
    }
    return `[${newN}]`; // 正文里替换成裸方括号 [新编号]
  });

  // refs 按首次出现顺序 push,新编号天然 1、2、3… 升序,无需再排序
  return { cleanedText, refs };
}
