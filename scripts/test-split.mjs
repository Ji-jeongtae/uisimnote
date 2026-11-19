import assert from 'node:assert/strict';
import fs from 'node:fs';
import { splitSentences } from '../lib/split.js';
import { normalize, validateInput } from '../lib/prompt.js';

const demo = JSON.parse(fs.readFileSync(new URL('../demo.json', import.meta.url), 'utf8'));
const s = splitSentences(demo.answer);
assert.equal(s.length, 10, '예시 답변은 10문장');
assert.deepEqual(demo.result.items.map((i) => i.id), demo.candidates, 'demo 분류는 후보 문장만(앱과 같음)');
assert.equal(s[1].prefix, '1.');
assert.ok(s[3].text.includes('55%'));

const t = splitSentences('Walters et al. (2023)에 따르면 55.3%다. 그러나 W. H. Walters는 다르게 봤다! 정말? 3. 목록\n- **굵게** 쓴 항목입니다.');
assert.deepEqual(t.map((x) => x.text), [
  'Walters et al. (2023)에 따르면 55.3%다.',
  '그러나 W. H. Walters는 다르게 봤다!',
  '정말?',
  '3. 목록',
  '굵게 쓴 항목입니다.',
]);
assert.equal(splitSentences('GPT-4는 ChatGPT. 다음 문장.').length, 2);

const n = normalize([
  { id: 1, level: 'info', types: ['날짜·법령', '논문·책 인용', '없는유형'], reason: 'r', media: ['academic', 'bad'], keywords: ['2023년 Nature에 실린', 'Walters Wilder 2023 ChatGPT citations'] },
  { id: 1, level: 'info' },
  { id: 9, level: 'weird' },
], [{ id: 1, text: '2023년 Nature에 실린 Walters와 Wilder의 연구' }, { id: 2, text: 'b' }]);
assert.equal(n.items.length, 2);
assert.deepEqual(n.items[0].media, ['academic']);
assert.deepEqual(n.items[0].types, ['날짜·법령', '논문·책 인용']);
assert.equal(n.items[0].level, 'must', '유형 표로 단계 재계산');
assert.deepEqual(n.items[0].keywords, ['Walters Wilder 2023 ChatGPT citations'], '문장 앞부분 자른 검색어 제거');
assert.equal(n.items[1].level, 'info');
assert.equal(n.missing, 1);
const cand = s.filter((x) => demo.candidates.includes(x.id));
const d2 = normalize(demo.result.items, cand);
assert.equal(d2.missing, 0);
assert.ok(d2.items.every((it, i) => it.level === demo.result.items[i].level), 'demo 단계가 유형 표와 일치');

assert.ok(validateInput({ sentences: [] }));
assert.equal(validateInput({ sentences: [{ id: 1, text: 'x' }] }), null);
console.log('ok — split/normalize/validate 테스트 통과');

// ---- 증빙서 조립 ----
import { buildReport, josa, linkOf } from '../lib/report.js';
assert.equal(josa('학술지', '을/를'), '를');
assert.equal(josa('원문', '을/를'), '을');
assert.equal(josa('Scientific Reports', '을/를'), '를'); // s=에스, 받침 없음
assert.equal(josa('CJ E&M(2018년 합병 후 CJ ENM)', '으로/로'), '으로'); // 괄호 앞 E&M=엠
assert.equal(josa('2023', '으로/로'), '으로'); // 삼
assert.equal(josa('~', '을/를'), '을(를)'); // 읽을 수 없으면 둘 다
assert.equal(josa('학술지명', '으로/로'), '으로');
assert.equal(josa('서울', '으로/로'), '로');
assert.equal(josa('가이드', '으로/로'), '로');
assert.equal(josa('원문', '과/와'), '과');
assert.equal(josa('보고서', '과/와'), '와');
const meta = { tool: 'ChatGPT (무료)', toolVersion: 'GPT-6', date: '2026-11-19', purpose: '아이디어 단계', question: 'Q', shareUrl: '' };
const r1 = buildReport({ meta, answer: 'AI 답변 원문', conclusion: '결론', compared: '', ratio: 50, items: [
  { no: 3, text: '2023년 Nature에 실린 Walters와 Wilder의 연구는 ChatGPT가 만든 학술 인용 636건을 검증했습니다.', verdict: 'problem', problem: 'Nature', cross: 'Walters & Wilder(2023) 원문', fix: 'Scientific Reports', location: '2장' },
  { no: 5, text: '짧은 문장', verdict: 'ok' }, { no: 6, text: 'x', verdict: 'unused' }, { no: 8, text: 'y' },
] });
assert.equal(r1[0].body, 'ChatGPT (무료) GPT-6(2026.11.19 사용)');
const v1 = r1[3].body;
assert.ok(v1.includes('확인이 필요한 주장 4개 중 확인함 1 · 문제 발견 1 · 사용 안 함 1 · 미확인 1, AI 표시 전 먼저 의심한 비율 50%'));
assert.ok(v1.includes('① AI 답변 중 "2023년 Nature에 실린 Walters와 Wild…"에서 Nature 부분이 실제와 다르게 답변됨'), v1);
assert.ok(v1.includes('① [원문 3번째 문장] Walters & Wilder(2023) 원문을 직접 찾아 교차 검증한 후, Scientific Reports로 정정함, 2장에 반영'), v1);
assert.ok(v1.includes('   대조 자료 링크: (URL 또는 DOI 작성 필요)'), v1); // 링크가 없으면 빠지지 않고 '작성 필요'로 드러난다
// 링크가 있으면: 자료 이름에서 링크를 떼고, 링크는 다음 줄에. DOI는 doi.org 주소로.
const r3 = buildReport({ meta, answer: 'a', conclusion: 'c', compared: '', ratio: 0, items: [
  { no: 2, text: 't', verdict: 'problem', problem: 'p', cross: 'CJ ENM 실적 발표 https://cjenm.com/ko/news/1', fix: 'f' },
  { no: 7, text: 't2', verdict: 'problem', problem: 'p', cross: 'Walters(2023) doi:10.1038/s41598-023-41032-5', fix: 'g' },
  { no: 9, text: 't3', verdict: 'problem', problem: 'p', cross: 'https://dart.fss.or.kr/x', fix: 'h' },
] });
const v3 = r3[3].body;
assert.ok(v3.includes('① [원문 2번째 문장] CJ ENM 실적 발표를 직접 찾아') && v3.includes('대조 자료 링크: https://cjenm.com/ko/news/1'), v3);
assert.ok(v3.includes('② [원문 7번째 문장] Walters(2023)') && v3.includes('대조 자료 링크: https://doi.org/10.1038/s41598-023-41032-5'), v3);
assert.ok(v3.includes('③ [원문 9번째 문장] 대조 자료를 직접 찾아') && v3.includes('대조 자료 링크: https://dart.fss.or.kr/x'), v3);
assert.equal(linkOf('자료 이름만'), '');
const r2 = buildReport({ meta, answer: '', conclusion: '', compared: 'KOSIS 통계', ratio: 0, items: [{ text: 'a', verdict: 'ok' }] });
assert.ok(r2[3].body.includes('확인이 필요한 주장 1개를 KOSIS 통계와 대조한 결과 실제와 다른 부분을 찾지 못함'), r2[3].body);
assert.ok(r2[2].body.includes('(AI 답변 작성 필요)'));
assert.ok(r1[2].body.includes('[AI답변1] AI 답변 원문'), r1[2].body);
console.log('ok — 증빙서 조립 테스트 통과');
