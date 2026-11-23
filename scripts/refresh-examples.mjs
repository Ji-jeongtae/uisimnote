// 예시 2개(demo.json, examples/participant-a.json)의 후보 문장 분류를 실제 Gemini로 다시 만든다.
// node scripts/refresh-examples.mjs   → 예시마다 1회 호출(총 2회), 원본 응답은 prompt-log/에 저장
// node scripts/refresh-examples.mjs examples/practice-writing.json   → 지정한 예시만(파일마다 1회)
// 앱과 같은 입력: 후보 5문장(lib/candidates.js 규칙, 예시에 저장된 candidates 우선)을 "[맥락] 문장" 형태로, 프롬프트는 앱과 같은 SYSTEM_PROMPT.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitSentences } from '../lib/split.js';
import { pickCandidates, contextOf } from '../lib/candidates.js';
import { PROMPT_VERSION, SYSTEM_PROMPT, classifyWithGemini } from '../lib/prompt.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
if (!apiKey) { console.error('.env에 GEMINI_API_KEY가 필요합니다.'); process.exit(1); }
const day = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); // 한국 날짜(YYYY-MM-DD)
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

const files = process.argv.slice(2).length ? process.argv.slice(2) : ['demo.json', 'examples/participant-a.json'];
for (const [i, rel] of files.entries()) {
  if (i) await new Promise((r) => setTimeout(r, 6000));
  const p = path.join(root, rel);
  const d = JSON.parse(fs.readFileSync(p, 'utf8'));
  const sents = splitSentences(d.answer);
  const candidates = d.candidates || pickCandidates(sents);
  const input = candidates.map((id) => {
    const s = sents.find((x) => x.id === id);
    const c = contextOf(sents, id);
    return { id, text: c ? `[${c}] ${s.text}` : s.text };
  });
  const t0 = Date.now();
  const out = await classifyWithGemini({ question: d.meta.question, sentences: input }, { apiKey, model, systemPrompt: SYSTEM_PROMPT });
  const label = path.basename(rel, '.json');
  fs.writeFileSync(path.join(root, 'prompt-log', `${stamp}_${label}_example-refresh_v3.json`), JSON.stringify({ at: new Date().toISOString(), model, promptVersion: PROMPT_VERSION, purpose: '예시 분류 교체', input: { question: d.meta.question, sentences: input }, raw: out.raw, items: out.items, missing: out.missing, ms: Date.now() - t0 }, null, 2));
  d.candidates = candidates;
  d.source = 'gemini';
  d.note = `${d.note ? d.note.replace(/분류[^.]*더미[^.]*\./g, '').replace(/\s*sites·official[^.]*\./g, '').trim() + ' ' : ''}분류는 실제 Gemini 결과(${day}, ${model}, 프롬프트 ${PROMPT_VERSION}) — 후보 ${candidates.length}문장만 분류.`.trim();
  d.result = { model: `실제 Gemini 결과(${day}, ${model})`, promptVersion: PROMPT_VERSION, items: out.items };
  fs.writeFileSync(p, JSON.stringify(d, null, 2) + '\n');
  console.log(`${rel}: ${Date.now() - t0}ms, 누락 ${out.missing}`);
  for (const it of out.items) console.log(`  ${it.id} ${it.level} ${it.types.join('+')} | ${sents.find((s) => s.id === it.id).text.slice(0, 30)}`);
}
console.log(`Gemini 호출 ${files.length}회`);
