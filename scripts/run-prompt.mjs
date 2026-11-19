// 분류 프롬프트 실험 기록용 (발표 C 문서 재료)
// 사용:
//   node scripts/run-prompt.mjs tests/answer01.txt            → 1회 실행
//   node scripts/run-prompt.mjs tests/answer01.txt --runs 3   → 3회 반복, 일관성 비교
//   node scripts/run-prompt.mjs --demo                        → demo.json을 실제 Gemini 결과로 교체
// 결과는 prompt-log/<날짜>_<파일>_<프롬프트버전>.json 에 입력·출력이 함께 저장된다.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSentences } from '../lib/split.js';
import { PROMPT_VERSION, classifyWithGemini } from '../lib/prompt.js';

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
const demo = args.includes('--demo');
const runs = Number(args[args.indexOf('--runs') + 1]) || (args.includes('--runs') ? 3 : 1);
const fileArg = args.find((a) => !a.startsWith('--') && a !== String(runs));

let answer, question = '', label;
if (demo) {
  const d = JSON.parse(fs.readFileSync(path.join(root, 'demo.json'), 'utf8'));
  answer = d.answer; question = d.meta.question; label = 'demo';
} else {
  if (!fileArg) { console.error('답변 txt 파일 경로를 주세요.'); process.exit(1); }
  const txt = fs.readFileSync(fileArg, 'utf8');
  // txt 첫 줄이 "Q: 질문" 이면 질문으로 사용
  const m = txt.match(/^Q:\s*(.+)\r?\n/);
  question = m ? m[1].trim() : '';
  answer = m ? txt.slice(m[0].length) : txt;
  label = path.basename(fileArg, path.extname(fileArg));
}

const sentences = splitSentences(answer).map(({ id, text }) => ({ id, text }));
const results = [];
for (let r = 0; r < runs; r++) {
  const t0 = Date.now();
  const out = await classifyWithGemini({ question, sentences }, { apiKey, model });
  results.push({ run: r + 1, ms: Date.now() - t0, missing: out.missing, items: out.items });
  console.log(`run ${r + 1}: ${Date.now() - t0}ms, 누락 ${out.missing}`);
}

// 반복 실행 간 단계(level) 일치율
let consistency = null;
if (runs > 1) {
  let same = 0;
  for (const s of sentences) {
    const lv = results.map((r) => r.items.find((i) => i.id === s.id)?.level);
    if (lv.every((x) => x === lv[0])) same++;
  }
  consistency = { sameLevelAllRuns: same, total: sentences.length, pct: Math.round((same / sentences.length) * 100) };
  console.log(`일관성: ${same}/${sentences.length} 문장이 ${runs}회 모두 같은 단계 (${consistency.pct}%)`);
}

// 판정 금지 위반 의심 단어 검사 (사람이 최종 확인)
const banned = /(사실입니다|사실이다|틀렸|틀린 |거짓|정확합니다|정확하다|존재하지 않|잘못되|오류입니다|맞습니다)/;
const flags = results.flatMap((r) => r.items.filter((i) => banned.test(i.reason)).map((i) => ({ run: r.run, id: i.id, reason: i.reason })));
if (flags.length) console.log(`⚠ 판정 표현 의심 ${flags.length}건 — 로그의 judgmentFlags 확인`);

console.table(sentences.map((s) => ({ id: s.id, level: results.map((r) => r.items.find((i) => i.id === s.id)?.level).join('/'), text: s.text.slice(0, 40) })));

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const ver = PROMPT_VERSION.split(' ')[0];
fs.mkdirSync(path.join(root, 'prompt-log'), { recursive: true });
const logPath = path.join(root, 'prompt-log', `${stamp}_${label}_${ver}.json`);
fs.writeFileSync(logPath, JSON.stringify({ at: new Date().toISOString(), model, promptVersion: PROMPT_VERSION, input: { question, sentences }, runs: results, consistency, judgmentFlags: flags }, null, 2));
console.log(`기록: ${path.relative(root, logPath)}`);

if (demo) {
  const p = path.join(root, 'demo.json');
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  d.note = `시연 데이터: ${new Date().toISOString().slice(0, 10)} ${model} 실제 실행 결과 (프롬프트 ${PROMPT_VERSION}).`;
  d.source = 'gemini';
  d.result = { model: `시연 모드 · 저장된 ${model} 결과`, promptVersion: PROMPT_VERSION, items: results[0].items };
  fs.writeFileSync(p, JSON.stringify(d, null, 2));
  console.log('demo.json을 실제 결과로 교체했습니다.');
}
