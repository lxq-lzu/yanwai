import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractAndValidateRefs } from '../backend/core/refs.js';
import type { Source } from '../backend/types.js';

function source(text: string): Source {
  return { type: 'zhihu_search', text, author: 'tester' };
}

describe('extractAndValidateRefs', () => {
  test('renumbers valid refs to bare [N] in appearance order', () => {
    const sources = [source('证据一'), source('证据二')];
    const text = '这段话的意思是这样 [ref:1]，另一部分参考 [ref:2]。';
    const { cleanedText, refs } = extractAndValidateRefs(text, sources);
    assert.equal(cleanedText, '这段话的意思是这样 [1]，另一部分参考 [2]。');
    assert.equal(refs.length, 2);
    assert.equal(refs[0]!.n, 1);
    assert.equal(refs[0]!.quote, '证据一');
    assert.equal(refs[1]!.n, 2);
  });

  test('renumbers by appearance order, not source index order', () => {
    const sources = [source('证据一'), source('证据二'), source('证据三')];
    const text = '先引 [ref:3]，再引 [ref:1]。';
    const { cleanedText, refs } = extractAndValidateRefs(text, sources);
    assert.equal(cleanedText, '先引 [1]，再引 [2]。');
    assert.equal(refs.length, 2);
    assert.equal(refs[0]!.n, 1);
    assert.equal(refs[0]!.quote, '证据三');
    assert.equal(refs[1]!.n, 2);
    assert.equal(refs[1]!.quote, '证据一');
  });

  test('repeated refs reuse the first-assigned number and appear once in refs', () => {
    const sources = [source('证据一'), source('证据二')];
    const text = '第一处 [ref:2]，第二处 [ref:2]，第三处 [ref:1]。';
    const { cleanedText, refs } = extractAndValidateRefs(text, sources);
    assert.equal(cleanedText, '第一处 [1]，第二处 [1]，第三处 [2]。');
    assert.equal(refs.length, 2);
    assert.equal(refs[0]!.n, 1);
    assert.equal(refs[0]!.quote, '证据二');
    assert.equal(refs[1]!.n, 2);
    assert.equal(refs[1]!.quote, '证据一');
  });

  test('strips out-of-range ref numbers (model hallucinated a citation)', () => {
    const sources = [source('唯一的证据')];
    const text = '第一点见 [ref:1]，第二点见 [ref:5]（编的）。';
    const { cleanedText, refs } = extractAndValidateRefs(text, sources);
    assert.equal(cleanedText, '第一点见 [1]，第二点见 （编的）。');
    assert.equal(refs.length, 1);
    assert.equal(refs[0]!.n, 1);
  });

  test('no sources at all strips every ref', () => {
    const text = '我编了一个 [ref:1] 出处。';
    const { cleanedText, refs } = extractAndValidateRefs(text, []);
    assert.equal(cleanedText, '我编了一个  出处。');
    assert.equal(refs.length, 0);
  });

  test('ref:0 is always invalid (1-indexed)', () => {
    const sources = [source('x')];
    const { cleanedText, refs } = extractAndValidateRefs('见 [ref:0]', sources);
    assert.equal(cleanedText, '见 ');
    assert.equal(refs.length, 0);
  });

  test('text with no refs at all passes through unchanged', () => {
    const { cleanedText, refs } = extractAndValidateRefs('平平无奇一句话', []);
    assert.equal(cleanedText, '平平无奇一句话');
    assert.equal(refs.length, 0);
  });
});
