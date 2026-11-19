// 프롬프트 버전 비교 실험: node scripts/eval-prompt.mjs [--runs 3] [--versions v3,v4]
// 입력 2가지 × 버전 × 반복 횟수만큼 실제 Gemini를 호출한다(기본 2×2×3 = 12회). 호출 사이 6초 쉰다(무료 사용량 보호).
//  - 참가자 A: 대화 전문 첫 답변(examples/participant-a.json)에서 정답표 10개 주장 문장만, 앱과 같은 "[맥락] 문장" 형태로
//  - 시연(demo.json): 10문장 전체. 정답표가 없어 '수기 예시 분류 대비'로만 비교(참고용)
// 결과: prompt-log/<시각>_<입력>_<버전>.json (실행별 원본) + prompt-log/<시각>_eval-summary.json/.md (표)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSentences } from '../lib/split.js';
import { contextOf } from '../lib/candidates.js';
import { PROMPTS, classifyWithGemini } from '../lib/prompt.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
if (!apiKey) { console.error('.env에 GEMINI_API_KEY가 필요합니다.'); process.exit(1); }
const args = process.argv.slice(2);
const runs = Number(args[args.indexOf('--runs') + 1]) || 3;
const versions = (args.includes('--versions') ? args[args.indexOf('--versions') + 1] : 'v3,v4').split(',');
const PAUSE = 6000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- 입력 만들기 ----
const pa = JSON.parse(fs.readFileSync(path.join(root, 'examples/participant-a.json'), 'utf8'));
const paSents = splitSentences(pa.answer);
// 시범사용_정답표_참가자A.md의 10개 주장 → 전문에서 찾을 문장 시작 + 기대 유형·단계
const KEY = [
  [1, '스튜디오드래곤은 2016년 CJ ENM의', ['날짜·법령'], 'must'],
  [2, '이후 CJ ENM은 스튜디오드래곤뿐', ['인물·기관 발언'], 'must'],
  [3, '교재에서는 500만 명', ['통계·수치', '논문·책 인용'], 'must'],
  [4, '한국 사회의 계층 문제를 다룬', ['날짜·법령'], 'must'],
  [5, 'CJ ENM은 이 작품을', ['인물·기관 발언'], 'must'],
  [6, '2025년 CJ ENM은 연결기준', ['통계·수치'], 'must'],
  [7, '다만 이는 커머스', ['통계·수치'], 'must'],
  [8, '회사는 글로벌 IP', ['인물·기관 발언'], 'must'],
  [9, 'CJ는 역량 있는 제작진을 영입하고', ['인과관계', '일반화'], 'should'],
  [10, '또한 글로벌 OTT와 협력하면', ['의견·요약', '개념 정의', '일반 상식'], 'info'],
];
const paInput = KEY.map(([no, start, types, level]) => {
  const s = paSents.find((x) => x.text.startsWith(start));
  if (!s) throw new Error(`정답표 ${no}번 문장을 전문에서 못 찾음: ${start}`);
  const c = contextOf(paSents, s.id);
  return { id: s.id, text: c ? `[${c}] ${s.text}` : s.text, key: { no, types, level } };
});
const demo = JSON.parse(fs.readFileSync(path.join(root, 'demo.json'), 'utf8'));
const demoSents = splitSentences(demo.answer);
const demoInput = demoSents.map((s) => {
  const it = demo.result.items.find((i) => i.id === s.id);
  return { id: s.id, text: s.text, key: it ? { no: s.id, types: it.types, level: it.level, manual: true } : null };
});
const INPUTS = [
  { label: 'participant-a', question: pa.meta.question, sentences: paInput, keyName: '정답표' },
  { label: 'demo', question: demo.meta.question, sentences: demoInput, keyName: '수기 예시(정답표 아님)' },
];

// ---- 측정 ----
const BANNED = /(사실입니다|사실이다|사실이 아니|틀렸|틀린 |거짓|정확합니다|정확하다|정확하지 않|존재하지 않|잘못되|잘못된|오류입니다|오류가 있|맞습니다|의심스럽|사실과 다르)/;
function measure(input, results) {
  const n = input.sentences.length;
  const byRun = results.map((r) => new Map(r.items.map((i) => [i.id, i])));
  let typeHit = 0, levelHit = 0, bothHit = 0, keyed = 0, consistent = 0;
  for (const s of input.sentences) {
    const outs = byRun.map((m) => m.get(s.id));
    const sig = outs.map((o) => `${o?.level}|${[...(o?.types || [])].sort().join(',')}`);
    if (sig.every((x) => x === sig[0])) consistent++;
    if (!s.key) continue;
    for (const o of outs) {
      keyed++;
      const t = (o?.types || []).some((x) => s.key.types.includes(x));
      const l = o?.level === s.key.level;
      typeHit += t; levelHit += l; bothHit += t && l;
    }
  }
  const flags = results.flatMap((r) => r.items.filter((i) => BANNED.test(i.reason || '')).map((i) => ({ run: r.run, id: i.id, reason: i.reason })));
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  return {
    sentences: n,
    keyMatch: { type: pct(typeHit, keyed), level: pct(levelHit, keyed), both: pct(bothHit, keyed), judged: keyed },
    consistency: { same: consistent, total: n, pct: pct(consistent, n) },
    judgmentFlags: flags,
  };
}

// ---- 실행 ----
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
fs.mkdirSync(path.join(root, 'prompt-log'), { recursive: true });
const summary = [];
let calls = 0;
for (const input of INPUTS) {
  for (const ver of versions) {
    const results = [];
    for (let r = 0; r < runs; r++) {
      if (calls++) await sleep(PAUSE);
      const t0 = Date.now();
      try {
        const out = await classifyWithGemini({ question: input.question, sentences: input.sentences.map(({ id, text }) => ({ id, text })) }, { apiKey, model, systemPrompt: PROMPTS[ver] });
        results.push({ run: r + 1, ms: Date.now() - t0, missing: out.missing, items: out.items });
        console.log(`${input.label} ${ver} run ${r + 1}: ${Date.now() - t0}ms, 누락 ${out.missing}`);
      } catch (e) {
        console.log(`${input.label} ${ver} run ${r + 1}: 실패 — ${String(e.message).slice(0, 160)}`);
        results.push({ run: r + 1, ms: Date.now() - t0, error: String(e.message).slice(0, 300), items: [] });
      }
    }
    const ok = results.filter((r) => !r.error);
    const m = measure(input, ok);
    const logPath = path.join(root, 'prompt-log', `${stamp}_${input.label}_${ver}.json`);
    fs.writeFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), model, promptVersion: ver, keyName: input.keyName, input: { question: input.question, sentences: input.sentences }, runs: results, metrics: m }, null, 2));
    summary.push({ input: input.label, keyName: input.keyName, version: ver, okRuns: ok.length, ...m, log: path.relative(root, logPath) });
  }
}

const md = [
  `# 프롬프트 v3·v4 비교 (${stamp.slice(0, 10)}, ${model}, 버전·입력마다 ${runs}회)`,
  '',
  '| 입력 | 비교 기준 | 버전 | 성공 실행 | 유형 일치 | 단계 일치 | 유형·단계 모두 | 3회 일관성 | 판정 표현 |',
  '|---|---|---|---|---|---|---|---|---|',
  ...summary.map((s) => `| ${s.input} (${s.sentences}문장) | ${s.keyName} | ${s.version} | ${s.okRuns}/${runs} | ${s.keyMatch.type ?? '-'}% | ${s.keyMatch.level ?? '-'}% | ${s.keyMatch.both ?? '-'}% | ${s.consistency.same}/${s.consistency.total} (${s.consistency.pct}%) | ${s.judgmentFlags.length}건 |`),
  '',
  '- 유형 일치: 모델이 낸 types 중 하나라도 기대 유형과 겹치면 일치(문장×실행 단위).',
  '- 3회 일관성: 세 번 모두 단계와 유형 묶음이 똑같은 문장 수.',
  '- 판정 표현: reason에 "사실이다·틀렸다·정확하다·존재하지 않는다·잘못·의심스럽다" 등이 들어간 건수(사람이 최종 확인).',
].join('\n');
fs.writeFileSync(path.join(root, 'prompt-log', `${stamp}_eval-summary.json`), JSON.stringify(summary, null, 2));
fs.writeFileSync(path.join(root, 'prompt-log', `${stamp}_eval-summary.md`), md + '\n');
console.log('\n' + md);
console.log(`\nGemini 호출 ${calls}회`);
