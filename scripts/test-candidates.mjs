// 2단계 후보 고르기 테스트 (API 호출 없음)
// node scripts/test-candidates.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { splitSentences } from '../lib/split.js';
import { pickCandidates, scoreSentence, contextOf, isSoftClaim } from '../lib/candidates.js';

// 조언·제목·출처 줄은 후보가 아니다
assert.ok(scoreSentence('네가 맡은 3번 파트는 작품 소개보다 전략 중심으로 구성하는 게 좋아.') < 4);
assert.equal(scoreSentence('스튜디오드래곤의 등장'), -99, '제목 줄');
assert.equal(scoreSentence('[CJ ENM 공식 연혁](https://example.com/a) — 성과 확인.'), -99, '출처 줄');
assert.ok(scoreSentence('2025년 CJ ENM은 연결기준 매출 5조 1,345억 원을 기록했다고 발표했어.') >= 8);

// 시범 사용 A 전문(224문장): 앱은 예시에 저장된 후보(실제 Gemini 분류와 짝)를 쓴다 — 정답표 1·3·4·5·6번
const pa = JSON.parse(fs.readFileSync(new URL('../examples/participant-a.json', import.meta.url), 'utf8'));
const s = splitSentences(pa.answer);
assert.deepEqual(pa.candidates, [92, 110, 117, 137, 169], '저장된 후보');
assert.deepEqual(pa.result.items.map((i) => i.id), pa.candidates, '저장된 분류는 저장된 후보와 짝');
assert.deepEqual(Object.values(pa.answerKey), [1, 3, 4, 5, 6]);
// 지금 규칙: 숫자 문장 4개 + 일반화·인과 문장 1자리(2026-11-19 규칙 보완), 대본의 같은 주장 반복은 빠진다
const ids = pickCandidates(s);
assert.equal(ids.length, 5);
for (const id of [92, 110, 137, 169]) assert.ok(ids.includes(id), `정답표 문장 ${id} 유지`);
assert.ok(ids.some((id) => isSoftClaim(s.find((x) => x.id === id).text)), '일반화·인과 문장 1개 이상');

// 숫자 문장이 많은 답변에서도 '대부분…' 같은 일반화 문장이 한 자리 들어간다(테스트 T1에서 빠졌던 문제)
const t1 = splitSentences('대학생 AI 활용을 정리해 줘.\n\nKERIS의 2024년 조사에 따르면 대학생의 81.4%가 AI를 쓴다고 답했습니다. 같은 조사에서 주 1회 이상 사용은 52%였습니다. 가장 많이 쓰는 용도는 자료 검색(63%)이었습니다. 대부분의 학생은 AI가 제시한 출처를 확인하지 않고 그대로 사용합니다. 교육부는 2025년 3월 가이드라인을 발표했습니다. 서울대학교는 2023년 국내 대학 최초로 지침을 공개했습니다.');
assert.ok(pickCandidates(t1).some((id) => t1.find((x) => x.id === id).text.startsWith('대부분의 학생은')), '일반화 문장 포함');
assert.match(contextOf(s, 137), /눈물의 여왕/, '맥락 제목');
assert.match(contextOf(s, 110), /공동경비구역/);

// 사실 주장이 적은 답변도 5개까지 채운다
const demo = JSON.parse(fs.readFileSync(new URL('../demo.json', import.meta.url), 'utf8'));
assert.equal(pickCandidates(splitSentences(demo.answer)).length, 5);

console.log('ok — 2단계 후보 고르기 테스트 통과');
