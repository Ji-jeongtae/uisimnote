// 로컬 개발 서버: node dev-server.mjs  →  http://localhost:3000
// .env의 GEMINI_API_KEY가 있으면 실제 Gemini를 호출하고, 없으면 MOCK 분류(정규식)로 화면만 확인한다.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from './api/classify.js';import { PROMPT_VERSION, validateInput, normalize } from './lib/prompt.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const envFile = path.join(root, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const MOCK = !process.env.GEMINI_API_KEY;
const PORT = Number(process.env.PORT || 3000);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };

function mockClassify(sentences) {
  // 로컬 화면 확인용 가짜 분류. 실제 분류 품질과 무관하다.
  return sentences.map(({ id, text }) => {
    const types = [];
    if (/논문|연구|보고서|학술지|책|저널/.test(text)) types.push('논문·책 인용');
    if (/\d+(\.\d+)?\s*(%|건|명|개|배)/.test(text)) types.push('통계·수치');
    if (/에 따르면|발표|밝혔|말했/.test(text) && !types.length) types.push('인물·기관 발언');
    if (/법|조항|가이드라인|제정|시행/.test(text)) types.push('날짜·법령');
    if (/때문|로 인해/.test(text)) types.push('인과관계');
    if (/대부분|항상|모두|반드시/.test(text)) types.push('일반화');
    if (!types.length) types.push('개념 정의');
    const words = text.replace(/[0-9.,%()“”"'·]+/g, ' ').split(/\s+/).filter((w) => w.length >= 2).map((w) => w.replace(/(은|는|이|가|을|를|의|에|와|과|에서|으로|로|도)$/, ''));
    const keywords = types[0] === '개념 정의' ? [] : [words.slice(1, 4).join(' '), words.slice(4, 7).join(' ')].filter(Boolean);
    return { id, types, level: 'info', reason: '[MOCK] 로컬 확인용 가짜 분류입니다.', media: ['academic'], keywords };
  });
}

function wrapRes(res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (o) => { res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(o)); return res; };
  return res;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/classify') {
    let raw = '';
    for await (const c of req) raw += c;
    wrapRes(res);
    let body = null;
    try { body = JSON.parse(raw); } catch { /* */ }
    if (MOCK) {
      const invalid = validateInput(body);
      if (invalid) return res.status(400).json({ error: invalid });
      await new Promise((r) => setTimeout(r, 700));
      return res.status(200).json({ items: normalize(mockClassify(body.sentences), body.sentences).items, missing: 0, model: 'MOCK(로컬)', promptVersion: PROMPT_VERSION, at: new Date().toISOString() });
    }
    req.body = body;
    return handler(req, res);
  }
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.statusCode = 403; return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) || path.basename(file).startsWith('.')) { res.statusCode = 404; return res.end('not found'); }
  res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`의심노트 개발 서버: http://localhost:${PORT}  (${MOCK ? 'MOCK 분류 — .env에 GEMINI_API_KEY 없음' : '실제 Gemini 호출'})`);
});
