// 2단계 후보 고르기 테스트 (API 호출 없음)
// node scripts/test-candidates.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { splitSentences } from '../lib/split.js';
import { pickCandidates, scoreSentence, contextOf } from '../lib/candidates.js';

// 조언·제목·출처 줄은 후보가 아니다
assert.ok(scoreSentence('네가 맡은 3번 파트는 작품 소개보다 전략 중심으로 구성하는 게 좋아.') < 4);
assert.equal(scoreSentence('스튜디오드래곤의 등장'), -99, '제목 줄');
assert.equal(scoreSentence('[CJ ENM 공식 연혁](https://example.com/a) — 성과 확인.'), -99, '출처 줄');
assert.ok(scoreSentence('2025년 CJ ENM은 연결기준 매출 5조 1,345억 원을 기록했다고 발표했어.') >= 8);

// 시범 사용 A 전문(224문장)에서 정답표 주장 1·3·4·5·6번이 뽑히고, 대본의 같은 주장 반복은 빠진다
const pa = JSON.parse(fs.readFileSync(new URL('../examples/participant-a.json', import.meta.url), 'utf8'));
const s = splitSentences(pa.answer);
const ids = pickCandidates(s);
assert.deepEqual(ids, pa.candidates, '예시에 저장된 후보와 규칙 결과가 같아야 함');
assert.equal(ids.length, 5);
assert.deepEqual(Object.values(pa.answerKey), [1, 3, 4, 5, 6]);
assert.match(contextOf(s, 137), /눈물의 여왕/, '맥락 제목');
assert.match(contextOf(s, 110), /공동경비구역/);

// 사실 주장이 적은 답변도 5개까지 채운다
const demo = JSON.parse(fs.readFileSync(new URL('../demo.json', import.meta.url), 'utf8'));
assert.equal(pickCandidates(splitSentences(demo.answer)).length, 5);

console.log('ok — 2단계 후보 고르기 테스트 통과');
