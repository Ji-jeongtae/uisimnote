import assert from 'node:assert/strict';
import fs from 'node:fs';
import { splitSentences, snapToWords } from '../lib/split.js';
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
import { buildReport, josa, linkOf, head30 } from '../lib/report.js';
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
// 형광펜 범위: 어절 경계로 넓힘
{
  const t = 'Kasneci 외(2023)는 Nature Education에 발표한';
  const pick = (a, b) => { const r = snapToWords(t, a, b); return r && t.slice(r.start, r.end); };
  assert.equal(pick(t.indexOf('ture'), t.indexOf('ture') + 2), 'Nature');
  assert.equal(pick(t.indexOf('Nat') + 1, t.indexOf('발표') + 1), 'Nature Education에 발표한');
  assert.equal(pick(t.indexOf(' Nature'), t.indexOf(' Nature') + 7), 'Nature'); // 앞 공백은 빼고
  assert.equal(pick(0, t.length), t);
  assert.equal(snapToWords(t, 7, 8), null); // 공백만
}
const r1 = buildReport({ meta, answer: 'AI 답변 원문', conclusion: '결론', compared: '', ratio: 50, items: [
  { no: 3, text: '2023년 Nature에 실린 Walters와 Wilder의 연구는 ChatGPT가 만든 학술 인용 636건을 검증했습니다.', verdict: 'problem', problem: 'Nature', cross: 'Walters & Wilder(2023) 원문', fix: 'Scientific Reports', location: '2장' },
  { no: 5, text: '짧은 문장', verdict: 'ok' }, { no: 6, text: 'x', verdict: 'unused' }, { no: 8, text: 'y' },
] });
assert.equal(r1[0].body, 'ChatGPT (무료) GPT-6(2026.11.19 사용)');
// 도구 '기타' + 버전: '기타'를 빼고 괄호 한 번
assert.equal(buildReport({ meta: { ...meta, tool: '기타', toolVersion: '연습용 답변 · GPT 형식', date: '2026-11-19' }, answer: 'a', conclusion: '', compared: '', ratio: 0, items: [] })[0].body, '연습용 답변 · GPT 형식 (2026.11.19 사용)');
assert.equal(buildReport({ meta: { ...meta, tool: '기타', toolVersion: '', date: '2026-11-19' }, answer: 'a', conclusion: '', compared: '', ratio: 0, items: [] })[0].body, '기타(2026.11.19 사용)');
const v1 = r1[3].body;
assert.ok(v1.includes('확인이 필요한 주장 4개 중 확인함 1 · 문제 발견 1 · 사용 안 함 1 · 미확인 1, AI 표시 전 먼저 의심한 비율 50%'));
assert.ok(v1.includes('① AI 답변 중 "2023년 Nature에 실린 Walters와…"에서 Nature 부분이 실제와 다르게 답변됨'), v1); // 띄어쓰기 단위로 자름
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
// 정정 방식 3가지: 고침(기본·예전 문장 그대로) / 삭제 / 표현 완화
const r4 = buildReport({ meta, answer: 'a', conclusion: 'c', compared: '', ratio: 0, items: [
  { no: 2, text: 't', verdict: 'problem', fixMode: 'fix', problem: 'Nature Education', cross: 'Kasneci 외(2023) https://doi.org/10.1016/j.lindif.2023.102274', fix: 'Learning and Individual Differences' },
  { no: 3, text: 't', verdict: 'problem', fixMode: 'delete', problem: 'Whitfield와 Okafor(2024)의 연구', cross: 'RISS·Google Scholar·KCI https://www.riss.kr/search/Search.do?query=Whitfield+Okafor', fix: '' },
  { no: 5, text: 't', verdict: 'problem', fixMode: 'soften', problem: '대신하기 때문입니다', cross: 'RISS·Google Scholar https://www.riss.kr/search/Search.do?query=AI', fix: 'AI 사용이 글쓰기 실력에 영향을 줄 수 있다는 우려가 있다', location: '결론' },
  { no: 6, text: 't', verdict: 'problem', fixMode: '이상한 값', problem: 'p', cross: '원문', fix: '정답' },
] });
const v4 = r4[3].body;
// [AI 답변의 문제점 발견]도 정정 방식에 맞춘다
assert.ok(v4.includes('① AI 답변 중 "t"에서 Nature Education 부분이 실제와 다르게 답변됨'), v4);
assert.ok(v4.includes('② AI 답변 중 "t"에서 Whitfield와 Okafor(2024)의 연구 부분의 출처를 확인할 수 없음'), v4);
assert.ok(v4.includes('③ AI 답변 중 "t"에서 대신하기 때문입니다 부분이 근거 없이 단정됨'), v4);
assert.ok(v4.includes('④ AI 답변 중 "t"에서 p 부분이 실제와 다르게 답변됨'), v4);
// 인용 발췌: 30자 안, 띄어쓰기 단위
assert.equal(head30('짧은 문장'), '짧은 문장');
assert.equal(head30('Whitfield와 Okafor(2024)의 연구는 국내 대학생 312명을 대상으로 AI 사용 집단의'), 'Whitfield와 Okafor(2024)의 연구는…');
assert.equal(head30('종합하면, AI를 쓰면 글쓰기 실력이 떨어지는 것은 AI가 생각하는 과정을'), '종합하면, AI를 쓰면 글쓰기 실력이 떨어지는 것은…');
assert.equal(head30('가'.repeat(40)), `${'가'.repeat(30)}…`); // 띄어쓰기가 없으면 글자로
for (const t of ['스튜디오드래곤은 2016년 CJ ENM의 드라마 사업부문을 물적분할해 설립됐어.', '2023년 Nature에 실린 Walters와 Wilder의 연구는 ChatGPT가']) {
  const h = head30(t).replace(/…$/, '');
  assert.ok(h.length <= 30 && t.startsWith(h) && /\s/.test(t[h.length]), h); // 단어 중간에서 끊기지 않음
}
assert.ok(v4.includes('① [원문 2번째 문장] Kasneci 외(2023)를 직접 찾아 교차 검증한 후, Learning and Individual Differences로 정정함\n'), v4);
assert.ok(v4.includes('② [원문 3번째 문장] RISS·Google Scholar·KCI에서 직접 찾아보았으나 확인되지 않아 해당 내용을 삭제함\n   대조 자료 링크: https://www.riss.kr/search/Search.do?query=Whitfield+Okafor'), v4);
assert.ok(v4.includes("③ [원문 5번째 문장] RISS·Google Scholar에서 근거를 확인할 수 없어 'AI 사용이 글쓰기 실력에 영향을 줄 수 있다는 우려가 있다'로 표현을 완화함, 결론에 반영"), v4);
assert.ok(v4.includes('④ [원문 6번째 문장] 원문을 직접 찾아 교차 검증한 후, 정답으로 정정함'), v4); // 모르는 값은 고침으로
assert.ok(!v4.includes('정정 내용 작성 필요'), v4); // 삭제는 정정 칸이 비어도 '작성 필요'가 아니다
// 친구 답변 예시(CJ E&M): fixMode가 없어도 문장이 예전과 한 글자도 다르지 않아야 한다(발표 슬라이드에 들어감)
{
  const fs = await import('node:fs');
  const pa = JSON.parse(fs.readFileSync(new URL('../examples/participant-a.json', import.meta.url), 'utf8'));
  const body = buildReport({ meta: pa.meta, answer: pa.answer, conclusion: pa.sampleConclusion, compared: '', ratio: 0,
    items: pa.candidates.map((no) => ({ no, text: splitSentences(pa.answer).find((x) => x.id === no).text, ...pa.sampleVerify[no] })) })[3].body;
  assert.ok(body.includes('① AI 답변 중 "스튜디오드래곤은 2016년 CJ ENM의 드라마…"에서 CJ ENM 부분이 실제와 다르게 답변됨'), body);
  assert.ok(body.includes('① [원문 92번째 문장] KIND 스튜디오드래곤 설립 관련 공시를 직접 찾아 교차 검증한 후, CJ E&M(2018년 합병 후 CJ ENM)으로 정정함, 슬라이드 3 스튜디오드래곤 설명에 반영\n   대조 자료 링크: https://kind.krx.co.kr/external/2023/05/15/002042/20230515004407/11013.htm'), body);
}
const r2 = buildReport({ meta, answer: '', conclusion: '', compared: 'KOSIS 통계', ratio: 0, items: [{ text: 'a', verdict: 'ok' }] });
assert.ok(r2[3].body.includes('확인이 필요한 주장 1개를 KOSIS 통계와 대조한 결과 실제와 다른 부분을 찾지 못함'), r2[3].body);
assert.ok(r2[2].body.includes('(AI 답변 작성 필요)'));
assert.ok(r1[2].body.includes('[AI답변1] AI 답변 원문'), r1[2].body);
console.log('ok — 증빙서 조립 테스트 통과');
