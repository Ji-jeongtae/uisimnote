import { splitSentences, snapToWords } from './lib/split.js';
import { buildReport, josa, linkOf, FIX_MODES, FIX_MODE_LABEL } from './lib/report.js';
import { SITES, siteUrl, siteSearchUrl } from './lib/sites.js';
import { checkShareUrl } from './lib/share.js';
import { pickCandidates, contextOf, MAX_CANDIDATES } from './lib/candidates.js';

/* ---------- 상수 ---------- */
const DRAFT_KEY = 'uisimnote.draft.v1';
const HISTORY_KEY = 'uisimnote.history.v1';
const DEMO = new URLSearchParams(location.search).has('demo');

const LEVEL = {
  must: { label: '확인 필수', cls: 'must' },
  should: { label: '확인 권장', cls: 'should' },
  info: { label: '참고', cls: 'info' },
};
const MEDIA = { academic: '학술 DB', statistics: '공공 통계', official: '원문 기관 자료' };
const VERDICT = { ok: '확인함', problem: '문제 있음', unused: '안 씀' };
// 2단계 이유 칩 (학생 예측). 앞 4개는 AI 분류 유형과 대응한다.
// '숫자'와 '날짜·제도'는 하나의 칩으로 합쳤다(2026-11-19). AI 유형 '통계·수치'·'날짜·법령' 둘 다에 대응한다.
// 편향(한쪽으로 치우친 말)·비약(근거에서 결론으로 건너뜀) 추가(2026-11-19). AI 유형에 '편향'은 없어 가장 가까운 '일반화'와 맞춘다.
const REASONS = { num: '숫자·날짜·제도', cite: '논문·책', who: '인물·기관 발언', bias: '편향', leap: '비약', unsure: '잘 모르겠음' };
const REASON_TYPE = { num: ['통계·수치', '날짜·법령'], cite: ['논문·책 인용'], who: ['인물·기관 발언'], bias: ['일반화'], leap: ['인과관계', '일반화'] };
// 'AI 조교의 한마디' — 유형별 고정 문구. Gemini의 reason은 화면에 쓰지 않는다(Gemini는 검색어만 제공).
const TIP_OPINION = '이 문장은 사실 확인보다 내 보고서의 입장과 맞는지 판단하면 돼요.';
const TIP = {
  '통계·수치': 'AI는 숫자를 말할 때 원문 없이 그럴듯한 값을 만들기도 해요. 이 숫자가 처음 나온 논문이나 보고서의 표에서 같은 값을 찾아보세요.',
  '논문·책 인용': 'AI가 말한 논문이 실제로 있는지부터 보세요. 제목과 저자로 검색해서 학술지 이름과 연도까지 맞는지 확인해요.',
  '인물·기관 발언': '누가 그렇게 말했다는 문장은 그 사람이나 기관의 원래 발표문에서 확인해야 해요. 기사나 요약글이 아니라 원문으로요.',
  '날짜·법령': '날짜와 제도는 자주 바뀌어요. 공식 사이트(법제처, 기관 홈페이지)에서 지금 기준으로 확인해요.',
  '일반화': "'대부분', '항상' 같은 말은 근거 없이 붙기 쉬워요. 어떤 조사에서 몇 명을 대상으로 한 말인지 찾아보세요.",
  '인과관계': "'~때문이다'는 원인 하나로 단정하는 말이에요. 다른 원인은 없는지, 근거 연구가 있는지 보세요.",
  '최신 동향': 'AI가 학습한 시점 이후로 바뀌었을 수 있어요. 최근 날짜의 자료로 확인해요.',
  '개념 정의': TIP_OPINION,
  '일반 상식': TIP_OPINION,
  '의견·요약': TIP_OPINION,
};
// 5단계 '다음 질문은 이렇게' 조건 (유형 → 조건 키)
const NEXT_COND = {
  stat: { label: '통계·수치', text: '수치마다 출처 제목·연도·링크를 함께 적고, 출처를 댈 수 없는 수치는 [출처 없음]으로 표시해 줘.' },
  cite: { label: '논문·책 인용', text: '인용한 논문·책은 DOI나 링크를 달아 줘. 내가 직접 확인할 거야.' },
  who: { label: '인물·기관 발언', text: '누가 언제 어디서 한 말인지 원문 출처와 함께 적어 줘.' },
  date: { label: '날짜·법령', text: '날짜와 제도는 기준 시점과 공식 출처를 함께 적어 줘.' },
  gen: { label: '일반화·인과관계', text: '한쪽 입장만 쓰지 말고, 반대 근거나 다른 원인도 함께 적어 줘.' },
  recent: { label: '최신 동향', text: '네가 알고 있는 정보의 기준 시점을 밝혀 줘.' },
};
const TYPE_COND = { '통계·수치': 'stat', '논문·책 인용': 'cite', '인물·기관 발언': 'who', '날짜·법령': 'date', '일반화': 'gen', '인과관계': 'gen', '최신 동향': 'recent' };
const TOOLS = ['ChatGPT', 'Gemini', 'Claude', 'DeepSeek', 'Microsoft Copilot', '뤼튼', 'Perplexity', '기타'];

/* ---------- 저장소 (실패해도 동작) ---------- */
const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 저장 불가 환경 */ }
  },
  del(key) { try { localStorage.removeItem(key); } catch { /* */ } },
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function freshState() {
  return {
    step: 1,
    maxStep: 1,
    sessionId: null,
    meta: { question: '', tool: TOOLS[0], toolOther: '', toolVersion: '', purpose: '', shareUrl: '', date: today() },
    answer: '',
    sentences: [],
    sourceAnswer: '',
    selected: [],
    doubtLog: null, // { ids, texts, at } — '비교하기'를 누른 순간의 선택
    ai: null,
    verify: {},
    reasons: {},  // 2단계 이유 칩(복수) { 문장id: ['num'(숫자·날짜·제도)|'cite'|'who'|'unsure', ...] }
    reasonNotes: {}, // 2단계 이유 직접 쓰기 { 문장id: '...' }
    candidates: null, // 2단계에 보여 줄 '의심해 볼 문장' id (전문에서 규칙으로 고름, 최대 5개)
    nextQ: null,  // 5단계 다음 질문 { checked: { 조건키: bool }, text: 학생이 고친 문장 | null }
    marks: {}, // 2단계 형광펜 { 문장id: [{ start, end }] } — 문장 안 글자 위치
    keepMine: {}, // 3단계 '내 판단 유지' { 문장id: true }
    summary: '', // (이전 '내 말 요약' — 더 이상 쓰지 않음)
    memo: '',     // 5단계 기억할 것 메모 (증빙서 밖)
    conclusion: '',
    compared: '', // 문제를 찾지 못했을 때 대조한 자료
  };
}

let state = Object.assign(freshState(), store.get(DRAFT_KEY, {}));
state.meta = { ...freshState().meta, ...state.meta };
// 이전 판정 방식(확인됨/틀려서 수정/확인 불가) 기록을 새 방식으로 옮긴다.
for (const v of Object.values(state.verify || {})) {
  if (v.verdict === 'confirmed') v.verdict = 'ok';
  else if (v.verdict === 'corrected') {
    v.verdict = 'problem';
    v.problem ??= v.diff; v.cross ??= v.source; v.fix ??= v.correction;
  } else if (v.verdict === 'unverifiable') delete v.verdict;
}
// 이전 이유 칩(단일 선택 문자열) 기록을 배열로 옮긴다.
state.reasonNotes ||= {};
// 이전 '문장 전체 선택' 기록은 문장 전체 형광펜으로 옮긴다.
state.marks ||= {};
for (const id of state.selected || []) {
  const s = (state.sentences || []).find((x) => x.id === id);
  if (s && !state.marks[id]?.length) state.marks[id] = [{ start: 0, end: s.text.length }];
}
// 예전 'ChatGPT (무료)/(유료)'는 'ChatGPT' 하나로
if (state.meta.tool?.startsWith('ChatGPT')) state.meta.tool = 'ChatGPT';
// 예전 '날짜·제도'(date) 칩은 합쳐진 '숫자·날짜·제도'(num)로 옮긴다.
const mergeDate = (list) => [...new Set(list.map((k) => (k === 'date' ? 'num' : k)))];
for (const [id, r] of Object.entries(state.reasons || {})) {
  if (typeof r === 'string') state.reasons[id] = mergeDate([r]);
  else if (!Array.isArray(r) || !r.length) delete state.reasons[id];
  else state.reasons[id] = mergeDate(r);
}
for (const [id, r] of Object.entries(state.autoReasons || {})) state.autoReasons[id] = mergeDate(r || []);
// 예시 답변 (저장된 분류 결과 포함). 이 답변들은 Gemini를 부르지 않고 저장된 결과를 쓴다.
// 시연 기본은 연습용 답변(2026-11-24). 친구 답변 예시는 두 번째로.
const EXAMPLES = [
  { key: 'practice', file: 'examples/practice-writing.json', label: '연습용 · AI와 대학생 글쓰기' },
  { key: 'pa', file: 'examples/participant-a.json', label: '시범 사용 A · CJ ENM 팀플' },
  { key: 'demo', file: 'demo.json', label: 'AI 인용 오류' },
];
const exampleCache = {};
async function loadExample(key) {
  if (exampleCache[key]) return exampleCache[key];
  const ex = EXAMPLES.find((x) => x.key === key);
  const res = await fetch(ex.file, { cache: 'no-store' });
  exampleCache[key] = await res.json();
  return exampleCache[key];
}
// 지금 답변과 같은 예시 (없으면 null)
async function findExample(answer) {
  const t = (answer || '').trim();
  for (const ex of EXAMPLES) {
    try {
      const d = await loadExample(ex.key);
      if (d.result && d.answer.trim() === t) return d;
    } catch { /* 예시 파일 없음 */ }
  }
  return null;
}
const cachedExample = (answer) => Object.values(exampleCache).find((d) => d.result && d.answer.trim() === (answer || '').trim()) || null;
// 연습용 예시(오류를 일부러 넣은 답변)를 쓰는 중이면 모든 단계 위에 알린다
const practiceNote = () => {
  const p = cachedExample(state.answer)?.practice;
  return p ? `<p class="practice-note" role="note">${esc(p)}</p>` : '';
};
let demoData = null;
let loading = false;
let lastError = null;

const save = () => store.set(DRAFT_KEY, state);
const $view = document.getElementById('view');

/* ---------- 유틸 ---------- */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

async function loadDemo() {
  demoData = await loadExample('demo');
  return demoData;
}

const toolName = () => (state.meta.tool === '기타' ? state.meta.toolOther || '기타' : state.meta.tool);

/* ---------- 비교 계산 ---------- */
const marksOf = (id) => (Array.isArray(state.marks?.[id]) ? state.marks[id] : []);
const markTexts = (id) => {
  const t = state.sentences.find((s) => s.id === Number(id))?.text || '';
  return marksOf(id).map((m) => t.slice(m.start, m.end));
};
// 문장 글자에 형광펜 구간을 입힌 HTML
function markedText(s, interactive) {
  const ms = marksOf(s.id);
  if (!ms.length) return esc(s.text);
  let out = '', pos = 0;
  ms.forEach((m, i) => {
    out += esc(s.text.slice(pos, m.start));
    out += `<mark class="hl"${interactive ? ` data-mark="${i}" data-id="${s.id}" title="누르면 지워져요"` : ''}>${esc(s.text.slice(m.start, m.end))}</mark>`;
    pos = m.end;
  });
  return out + esc(s.text.slice(pos));
}
// 겹치거나 붙은 구간은 합친다
function mergeMarks(list) {
  const sorted = [...list].sort((x, y) => x.start - y.start);
  const out = [];
  for (const m of sorted) {
    const last = out[out.length - 1];
    if (last && m.start <= last.end) last.end = Math.max(last.end, m.end);
    else out.push({ ...m });
  }
  return out;
}
const syncSelected = () => {
  state.selected = state.sentences.map((s) => s.id).filter((id) => marksOf(id).length);
};

const reasonsOf = (id) => (Array.isArray(state.reasons?.[id]) ? state.reasons[id] : []);
const reasonTypesOf = (id) => [...new Set(reasonsOf(id).flatMap((k) => REASON_TYPE[k] || []))];
// '이유도 같은 비율'용: 형광펜 내용으로 자동으로 켜진 칩은 빼고 학생이 직접 고른 칩만
// (비교한 뒤에는 그 순간 기록 doubtLog.autoReasons, 비교 전에는 state.autoReasons)
const autoOf = (id) => (state.doubtLog?.autoReasons ?? state.autoReasons ?? {})[id] || [];
const manualTypesOf = (id) => [...new Set(reasonsOf(id).filter((k) => !autoOf(id).includes(k)).flatMap((k) => REASON_TYPE[k] || []))];
const noteOf = (id) => (state.reasonNotes?.[id] || '').trim();
// "숫자 · 논문·책 · 직접: …" 형태의 내 예측 문구
function reasonText(id) {
  const parts = reasonsOf(id).map((k) => REASONS[k]).filter(Boolean);
  const note = noteOf(id);
  if (note) parts.push(`직접: ${note}`);
  return parts.join(', ');
}

// 검증 대상은 중요한 것 MAX_TARGETS개까지만 (2026-11-19 정태 결정).
// AI가 확인 필수·권장으로 본 문장을 우선순위로 줄 세워 위에서 5개만 '확인 필요'로 남기고,
// 나머지는 참고로 내린다(원래 단계는 origLevel에 남겨 상세에서 알려 준다). Gemini 호출은 늘지 않는다.
const MAX_TARGETS = 5;
const TYPE_WEIGHT = { '통계·수치': 3, '논문·책 인용': 3, '인물·기관 발언': 2, '날짜·법령': 2, '인과관계': 1, '일반화': 1, '최신 동향': 1 };
function pickTargets(items) {
  const score = (it) => (it.level === 'must' ? 100 : 50) + typesOf(it).reduce((s, t) => s + (TYPE_WEIGHT[t] || 0), 0);
  return new Set(items.filter((it) => it.level === 'must' || it.level === 'should')
    .map((it, i) => ({ it, i, s: score(it) }))
    .sort((x, y) => y.s - x.s || x.i - y.i)
    .slice(0, MAX_TARGETS)
    .map((x) => x.it.id));
}

function analysis() {
  const sel = new Set(state.selected);
  // 2단계에서 후보만 보여 줬다면 분석도 후보 문장만(저장된 분류가 전문 전체여도 안 보인 문장은 '놓침'이 아니다)
  const shown = hasCandidates() ? new Set(state.candidates) : null;
  const raw = (state.ai?.items || []).filter((it) => !shown || shown.has(it.id));
  const keep = pickTargets(raw);
  const items = raw.map((it) => ((it.level === 'must' || it.level === 'should') && !keep.has(it.id) ? { ...it, level: 'info', origLevel: it.level } : it));
  const byId = new Map(items.map((it) => [it.id, it]));
  const flagged = items.filter((it) => it.level === 'must' || it.level === 'should').map((it) => it.id);
  const first = flagged.filter((id) => sel.has(id));
  const missed = flagged.filter((id) => !sel.has(id));
  const extra = state.selected.filter((id) => !flagged.includes(id));
  const targets = state.sentences.map((s) => s.id).filter((id) => flagged.includes(id) || sel.has(id));
  const number = new Map(targets.map((id, i) => [id, i + 1]));
  // 이유 예측: '잘 모르겠음'을 뺀 칩을 고른 문장 중, 칩 유형이 AI 분류 유형에 들어 있는 비율
  // 이유 예측: '잘 모르겠음'을 뺀 칩을 하나 이상 고른 문장 중, 고른 칩 유형 하나라도 AI 분류 유형에 들어 있는 비율
  const predicted = state.selected.filter((id) => manualTypesOf(id).length);
  const matched = predicted.filter((id) => reasonMatches(id, byId.get(id)));
  return { sel, byId, flagged, first, missed, extra, targets, number, ratio: pct(first.length, flagged.length),
    predicted, matched, reasonRatio: pct(matched.length, predicted.length) };
}

function reasonMatches(id, it) {
  const ai = typesOf(it);
  return manualTypesOf(id).some((t) => ai.includes(t));
}

// 4단계 집계. '안 씀'은 경고에서 빠진다.
function verifyStats(a) {
  let ok = 0, problem = 0, unused = 0, sources = 0;
  const mediaUsed = {};
  const uncheckedMust = [];
  for (const id of a.targets) {
    const v = state.verify[id] || {};
    if (v.verdict === 'ok') ok++;
    else if (v.verdict === 'problem') problem++;
    else if (v.verdict === 'unused') unused++;
    else if (a.byId.get(id)?.level === 'must') uncheckedMust.push(id);
    if (v.verdict === 'unused') continue;
    if (v.verdict === 'problem' && (v.cross || '').trim()) sources++;
    if (v.verdict !== 'problem' && (v.source || '').trim()) {
      sources++;
      if (v.media) mediaUsed[v.media] = (mediaUsed[v.media] || 0) + 1;
    }
  }
  const total = a.targets.length;
  const seen = ok + problem + unused;
  return { ok, problem, unused, seen, total, unseen: total - seen, sources, mediaUsed, uncheckedMust };
}

const typesOf = (it) => (Array.isArray(it?.types) && it.types.length ? it.types : (it?.type ? [it.type] : []));
// 대표 유형: '의견·요약' 같은 참고 유형보다 확인 방법이 있는 유형(CHECK_OF)을 앞세운다
// (2026-11-24: Gemini가 인과 단정 문장을 '의견·요약+인과관계'로 주면 놓친 유형이 '의견·요약'으로 묶였음)
const mainType = (it) => { const t = typesOf(it); return t.find((x) => CHECK_OF[x]) || t[0]; };
const circled = (n) => (n >= 1 && n <= 20 ? String.fromCharCode(0x2460 + n - 1) : `(${n})`);
const fmtDate = (d) => (d || '').replace(/-/g, '.');
const fmtTime = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/* ---------- 검색 링크 ---------- */
function searchUrl(kind, q) {
  const e = encodeURIComponent(q);
  switch (kind) {
    case 'riss': return `https://www.riss.kr/search/Search.do?isDetailSearch=N&searchGubun=true&query=${e}`;
    case 'scholar': return `https://scholar.google.com/scholar?q=${e}`;
    case 'kosis': return `https://kosis.kr/search/search.do?query=${e}`;
    default: return `https://www.google.com/search?q=${e}`;
  }
}
function primaryKind(media) {
  if (media?.[0] === 'academic') return 'scholar';
  if (media?.[0] === 'statistics') return 'kosis';
  return 'google';
}
// 이전 결과(v2 이하)에 sites가 없을 때: media로 대신 고른다
function sitesOf(it) {
  if (Array.isArray(it?.sites)) return it.sites.filter((k) => SITES[k]);
  return [...(it?.media?.includes('academic') ? ['riss', 'scholar'] : []), ...(it?.media?.includes('statistics') ? ['kosis'] : [])];
}
// 첫 줄: AI 답변에 이 문장의 출처 링크가 있으면 그 링크 그대로, 없으면 검색어.
// 둘째 줄: Gemini가 이 문장에 맞게 고른 '믿을 만한 곳'(목록 사이트 + 기관 공식 사이트) — 주소는 우리가 만든다.
function searchBlock(it, id) {
  const src = id != null ? aiSources(Number(id)) : [];
  const kwsList = it?.keywords || [];
  const q = kwsList[0] || '';
  // 1) AI가 언급한 링크(문장 안·각주·같은 단락의 자료 출처) — 눌러서 그 페이지로 이동
  const links = src.length
    ? `<div class="tags src-row"><span class="small muted">AI가 언급한 링크</span>${src.map((x) => `<a class="kw src" target="_blank" rel="noopener noreferrer" href="${esc(x.url)}" title="${esc(x.url)}${x.section ? ' · 같은 단락의 자료 출처' : ''}">${esc(x.label || shortUrl(x.url))} ↗</a>`).join('')}</div>
       <p class="small muted src-note">AI가 단 링크도 열어서 이 문장의 내용이 실제로 있는지 확인하세요. 없는 주소이거나 다른 내용이면 '문제 있음'이에요.${src.some((x) => x.section) ? ' (같은 단락에 붙어 있던 링크라 이 문장과 직접 관련 없을 수도 있어요)' : ''}</p>`
    : '';
  // 2) 검색어 — 누르면 복사(이동하지 않음). 아래 '믿을 만한 곳'에 붙여 넣어 찾기
  const kws = kwsList.length
    ? `<div class="tags"><span class="small muted">검색어 복사</span>${kwsList.map((k) => `<button type="button" class="kw kw-copy" data-action="copy-kw" data-kw="${esc(k)}" title="눌러서 복사">${esc(k)} <span aria-hidden="true">⧉</span></button>`).join('')}</div>`
    : '';
  const first = links + kws;
  if (!q && !src.length) return '';
  const query = q || (state.sentences.find((s) => s.id === Number(id))?.text || '').slice(0, 40);
  const trusted = [
    ...sitesOf(it).map((k) => `<a target="_blank" rel="noopener" href="${siteUrl(k, query)}" title="${esc(SITES[k].desc)}">${esc(SITES[k].name)}</a>`),
    ...(it?.official || []).map((o) => `<a target="_blank" rel="noopener" href="${siteSearchUrl(o.domain, query)}" title="${esc(o.domain)} 안에서 검색">${esc(o.name)} 공식 사이트</a>`),
  ].join('');
  const google = `<a target="_blank" rel="noopener" href="${searchUrl('google', query)}">Google</a>`;
  return `${first}
    <div class="hint-row search-links">${trusted ? `<span>믿을 만한 곳에서 찾기:</span>${trusted}<span class="sep">일반 검색:</span>` : '<span>일반 검색:</span>'}${google}</div>`;
}

/* ---------- AI가 답변에 함께 준 출처 ---------- */
const URL_RE = /https?:\/\/[^\s<>"'()\[\]]+[^\s<>"'()\[\].,;:!?。]/g;
const DOI_RE = /\b(?:doi:\s*)?(10\.\d{4,9}\/[^\s<>"'()\[\]]+[^\s<>"'()\[\].,;:!?])/gi;
const shortUrl = (u) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 60) + (u.length > 70 ? '…' : '');
function linksIn(text) {
  const out = [];
  for (const m of text.matchAll(URL_RE)) out.push(m[0]);
  for (const m of text.matchAll(DOI_RE)) {
    const u = `https://doi.org/${m[1]}`;
    if (!out.some((x) => x.includes(m[1]))) out.push(u);
  }
  return out;
}
// 답변 끝 참고문헌 목록: "[1] 제목 https://…", "1. 제목 doi:10.…" → 번호별 링크
function footnoteLinks() {
  const map = new Map();
  for (const line of (state.answer || '').split(/\r?\n/)) {
    const m = line.match(/^\s*\[?\^?(\d{1,2})[\].):]\s*(.+)$/);
    if (!m) continue;
    const links = linksIn(m[2]);
    if (links.length) map.set(m[1], { links, label: m[2].replace(URL_RE, '').replace(DOI_RE, '').replace(/[\s,.·\-–—:]+$/, '').trim() });
  }
  return map;
}
// 같은 단락(앞뒤 제목 줄 사이)에 AI가 적어 둔 링크: "자료 출처: [제목](URL)" 같은 줄
// 문장 자체에 링크가 없어도, AI가 그 부분의 근거로 단 링크를 찾아 준다.
const MD_LINK = /\[([^\]]{1,120})\]\((https?:\/\/[^)\s]+)\)/g;
function sectionLinks(text) {
  const raw = String(state.answer || '').replace(/\r\n/g, '\n').replace(/\*\*|__|`/g, '');
  const key = text.replace(/\*\*|__|`/g, '').slice(0, 30);
  const at = key ? raw.indexOf(key) : -1;
  if (at < 0) return [];
  // 단락 경계는 큰 제목(#~###)만. '#### 소제목' 아래에 '자료 출처'가 오는 경우가 많아 소제목은 같은 단락으로 본다.
  const isHead = (line) => /^\s*#{1,3}\s/.test(line);
  const lines = raw.split('\n');
  let pos = 0, idx = 0;
  for (; idx < lines.length; idx++) { if (pos + lines[idx].length >= at) break; pos += lines[idx].length + 1; }
  let s = idx; while (s > 0 && !isHead(lines[s])) s--;
  let e = idx + 1; while (e < lines.length && !isHead(lines[e])) e++;
  const out = [];
  for (const m of lines.slice(s, e).join('\n').matchAll(MD_LINK)) out.push({ url: m[2], label: m[1].trim(), section: true });
  if (out.length) return out;
  // 같은 단락에 없으면: 답변 전체 링크 중 제목이 이 문장과 낱말 2개 이상 겹치는 것(예: 끝의 참고문헌 목록)
  const STOP = new Set(['CJ', 'ENM', '및', '관련', '자료', '공식', '주요', '소개']);
  const words = (t) => new Set((t.match(/[가-힣A-Za-z0-9]{2,}/g) || []).map((w) => w.replace(/(은|는|이|가|을|를|의|에|와|과|로|으로|에서|했어|했다)$/, '')).filter((w) => w.length >= 2 && !STOP.has(w)));
  const mine = words(text);
  for (const m of raw.matchAll(MD_LINK)) {
    const hit = [...words(m[1])].filter((w) => mine.has(w)).length;
    if (hit >= 2) out.push({ url: m[2], label: m[1].trim(), section: true });
  }
  return out.slice(0, 2);
}
function aiSources(id) {
  const text = state.sentences.find((s) => s.id === id)?.text || '';
  const found = linksIn(text).map((u) => ({ url: u, label: '' }));
  const notes = footnoteLinks();
  for (const m of text.matchAll(/\[\^?(\d{1,2})\]/g)) {
    const n = notes.get(m[1]);
    if (n) n.links.forEach((u) => found.push({ url: u, label: `[${m[1]}] ${n.label}`.trim() }));
  }
  found.push(...sectionLinks(text));
  const seen = new Set();
  return found.filter((x) => !seen.has(x.url) && seen.add(x.url)).slice(0, 4);
}

function mediaText(it) {
  return it?.media?.length ? it.media.map((m) => MEDIA[m]).join(' · ') : '';
}

/* ---------- 답변 렌더링 ---------- */
const hasCandidates = () => Array.isArray(state.candidates) && state.candidates.length > 0;
const visibleSentences = () => (hasCandidates() ? state.sentences.filter((s) => state.candidates.includes(s.id)) : state.sentences);

function renderAnswer(mode) {
  const a = state.ai ? analysis() : null;
  const sel = new Set(state.selected);
  const paras = [];
  // 후보 목록이면 한 문장씩 번호 목록으로(문단 묶음 없이), 위에 짧은 맥락(작품·항목 제목)을 붙인다
  if (hasCandidates()) {
    visibleSentences().forEach((s, i) => { paras[i] = [{ ...s, prefix: `${i + 1}.`, lineStart: false, ctx: contextOf(state.sentences, s.id) }]; });
  } else {
    for (const s of state.sentences) (paras[s.para] ||= []).push(s);
  }
  return paras.filter(Boolean).map((group) => {
    const ctx = group[0].ctx ? `<div class="cand-ctx">${esc(group[0].ctx)}</div>` : '';
    const html = group.map((s, i) => {
      const br = s.lineStart && i > 0 ? '<br>' : '';
      const pre = s.prefix ? `<span class="pre">${esc(s.prefix)}</span>` : '';
      if (mode === 'select') {
        const locked = !!state.ai;
        const span = `${br}${pre}<span class="sent${sel.has(s.id) ? ' has-mark' : ''}" tabindex="${locked ? -1 : 0}" data-id="${s.id}" ${locked ? 'aria-disabled="true"' : 'aria-label="문장. 드래그해서 형광펜을 긋거나 Enter로 문장 전체에 긋기"'}>${markedText(s, !locked)}</span> `;
        // 비교 후 2단계: 놓친 문장 아래에 '✓ 놓침 · 유형'(확인 권장이면 ▲, 3단계와 같은 기호)
        const missedTag = locked && a?.missed.includes(s.id) ? `<span class="missed-tag"><i class="g mk">${markOf(a.byId.get(s.id)?.level, false).sym}</i> 놓침 · ${esc(mainType(a.byId.get(s.id)) || '')}</span>` : '';
        return span + (sel.has(s.id) ? reasonChips(s.id, locked) : '') + missedTag;
      }
      const it = a.byId.get(s.id);
      const lv = it?.level || 'info';
      const flagged = lv === 'must' || lv === 'should';
      const mine = sel.has(s.id);
      const { g, label: gl } = markOf(lv, mine);
      return `<div class="srow"><span class="gut"${gl ? ` title="${gl}"` : ''}>${g}</span><span class="stext">${pre}<span class="sent lv-${lv}${s.id === activeId ? ' open' : ''}" data-id="${s.id}" role="button" tabindex="0" aria-label="${gl ? `${gl}. ` : ''}눌러서 상세 보기">${markedText(s, false)}</span></span></div>`;
    }).join('');
    return mode === 'select' ? `${ctx}<p${hasCandidates() ? ' class="cand"' : ''}>${html}</p>` : `<div class="para${hasCandidates() ? ' cand' : ''}">${ctx}${html}</div>`;
  }).join('');
}

function reasonChips(id, locked) {
  const cur = reasonsOf(id);
  const note = noteOf(id);
  if (locked) {
    const chips = cur.map((k) => `<span class="chip on">${esc(REASONS[k])}</span>`).join('');
    const memo = note ? `<span class="chip on note">${esc(note)}</span>` : '';
    return `<span class="reason-chips"><span class="chip-label">내 예측</span>${chips || memo ? chips + memo : '<span class="chip-label">고르지 않음</span>'}</span>`;
  }
  return `<span class="reason-chips" role="group" aria-label="이 문장을 고른 이유(여러 개 선택 가능)"><span class="chip-label">이유</span>${Object.entries(REASONS).map(([k, t]) =>
    `<button type="button" class="chip ${cur.includes(k) ? 'on' : ''}" aria-pressed="${cur.includes(k)}" data-chip="${k}" data-id="${id}">${t}</button>`).join('')}<input type="text" class="reason-note" data-reason-note="${id}" value="${esc(state.reasonNotes?.[id] || '')}" maxlength="60" placeholder="직접 쓰기" aria-label="이 문장을 고른 이유 직접 쓰기"></span>`;
}

/* ---------- 단계별 화면 ---------- */
/* 넓은 화면(1200px 이상)에서 왼쪽 = 주 작업, 오른쪽 = 입력·요약·버튼(따라오는 열). 좁으면 위아래로 쌓인다. */
const splitView = (head, main, side, cls = '') => `
  <div class="step-head">${head}</div>
  <div class="split${cls ? ` ${cls}` : ''}">
    <div class="col-main">${main}</div>
    <aside class="col-side" aria-label="이 단계의 입력과 버튼">${side}</aside>
  </div>`;

// 비교 표시 기호(2026-11-24 정태: 표시를 줄임). 번호 옆에 하나만, 빨간색(#E5484D) 하나만.
//  확인 필수 + 먼저 찾음 = ● / 확인 필수 + 놓침 = ✓ + 작은 '놓침' / 확인 권장 = ▲ / 나만 의심·참고 = 표시 없음
//  '이유도 같음'은 기호 없이, 문장을 누르면 AI 조교의 한마디에 한 줄로만.
// 빨간펜으로 손으로 그은 듯한 기호(살짝 비뚤게). pathLength=1이라 CSS로 0.4초 안에 그어지게 할 수 있다.
const PEN = {
  dot: '<svg class="pen pen-dot" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path class="ink-fill" pathLength="1" d="M10.2 4.7c3-.3 5.3 2 5.2 5-.1 3.1-2.6 5.3-5.6 5.2-2.9-.1-4.8-2.4-4.6-5.2.2-2.7 2.4-4.8 5.2-5.2"/></svg>',
  chk: '<svg class="pen pen-chk" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path pathLength="1" d="M3.4 10.6c1.4 1.2 2.6 2.7 3.7 4.4 2.2-4.5 5.2-8 9.4-10.8"/></svg>',
  tri: '<svg class="pen pen-tri" viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path class="ink-fill" pathLength="1" d="M10.3 3.8c2.1 3.7 4.1 7.4 6.3 11.7-4.4.4-8.7.4-13.2.2 2.2-4.1 4.4-8 6.9-11.9"/></svg>',
};
function markOf(level, mine) {
  if (level === 'must') return mine
    ? { sym: PEN.dot, g: `<i class="g mk">${PEN.dot}</i>`, label: '확인 필수, 먼저 찾음' }
    : { sym: PEN.chk, g: `<i class="g mk">${PEN.chk}</i><small class="g-miss">놓침</small>`, label: '확인 필수, 놓침' };
  if (level === 'should') return { sym: PEN.tri, g: `<i class="g mk">${PEN.tri}</i>`, label: mine ? '확인 권장, 먼저 찾음' : '확인 권장, 놓침' };
  return { sym: '', g: '', label: '' };
}
const LEGEND_HTML = `<ul class="legend">
      <li><i class="g mk">${PEN.dot}</i>먼저 찾음</li>
      <li><i class="g mk">${PEN.chk}</i>놓침</li>
      <li><i class="g mk">${PEN.tri}</i>확인 권장</li>
    </ul>`;

function viewStep1() {
  const m = state.meta;
  const head = `<h2>1. AI 답변 붙여넣기</h2>
  <p class="lead">AI와 나눈 대화를 <b>질문부터 답변까지 통째로</b> 드래그해 붙여 넣으세요. 왼쪽 증빙서 정보가 자동으로 채워져요.</p>`;
  const main = `
  <div class="panel side-form info-form">
    <h3 class="form-title">증빙서에 들어갈 정보 <span class="muted small" id="autofill-note">${state.autoFilled ? '붙여 넣은 대화에서 채웠어요. 맞는지 확인하세요.' : ''}</span></h3>
    <label class="field share-field"><span>대화 공유 URL <em>선택 · 넣으면 사용한 AI 도구가 채워져요</em></span>
      <input type="url" data-bind="meta.shareUrl" value="${esc(m.shareUrl)}" maxlength="500" placeholder="https://chatgpt.com/share/...">
      <span class="share-note" id="share-note">${shareNote(m.shareUrl)}</span></label>
    <label class="field"><span>원래 질문 <em>AI에게 무엇을 물었나요?</em></span>
      <input type="text" data-bind="meta.question" maxlength="500" value="${esc(m.question)}" placeholder="예: 생성형 AI가 만든 학술 인용은 얼마나 정확한지 레포트용으로 정리해 줘"></label>
    <div class="grid-2">
      <label class="field"><span>사용한 AI 도구</span>
        <select data-bind="meta.tool">${TOOLS.map((t) => `<option ${t === m.tool ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
      <label class="field"><span>AI 도구 버전 <em>모델 이름</em></span>
        <input type="text" data-bind="meta.toolVersion" value="${esc(m.toolVersion)}" maxlength="40" placeholder="예: GPT-6"></label>
    </div>
    ${m.tool === '기타' ? `<label class="field"><span>도구 이름</span><input type="text" data-bind="meta.toolOther" value="${esc(m.toolOther)}" maxlength="40"></label>` : ''}
    <div class="grid-2">
      <label class="field"><span>사용 날짜</span>
        <input type="date" data-bind="meta.date" value="${esc(m.date)}"></label>
    </div>
    <label class="field" style="margin-bottom:0"><span>활용 목적 및 범위 <em>필수 · ${state.purposeAuto ? '질문을 보고 추측해서 넣었어요, 고쳐 써도 돼요' : '[확인]을 누르면 추측해서 채워요'}</em></span>
      <input type="text" data-bind="meta.purpose" value="${esc(m.purpose)}" maxlength="200" placeholder="예: 선행 연구 자료 조사의 아이디어 단계"></label>
  </div>
  <p class="side-note">개인정보·공개되지 않은 과제 내용은 넣지 마세요. 무료 Gemini API에 보낸 내용은 Google 제품 개선에 쓰일 수 있어요.</p>`;
  const side = `
  <div class="side-nav">
    <span class="nav-status">AI 대화 붙여넣기</span>
    <button class="primary small-btn" data-action="to-2">다음: 먼저 의심하기 →</button>
  </div>
  <label class="field answer-field"><span>AI 대화 <em>AI에게 한 질문부터 답변까지 함께 붙여 넣으세요 · 20,000자까지</em></span>
    <textarea class="answer-input" data-bind="answer" maxlength="20000" placeholder="AI에게 한 질문과 받은 답변을 함께 붙여 넣은 뒤 [확인]을 누르세요.&#10;&#10;예)&#10;나의 말:&#10;CJ ENM 글로벌 전략 자료 조사해 줘&#10;ChatGPT의 말:&#10;스튜디오드래곤은 …">${esc(state.answer)}</textarea>
  </label>
  <div class="answer-foot">
    <span class="ex-label">예시</span>
    ${EXAMPLES.map((ex) => `<button class="small-btn ghost" data-action="load-demo" data-key="${ex.key}">${esc(ex.label)}</button>`).join('')}
    <span class="spacer"></span>
    <button class="primary small-btn" data-action="confirm-paste">확인 — 정보 채우기</button>
    <span class="count" id="answer-count">${state.answer.length.toLocaleString()} / 20,000자</span>
  </div>`;
  return splitView(head, main, side);
}

/* ---------- 대화 통째로 붙여넣기 → 질문·도구·답변 나누기 ----------
   ChatGPT 웹에서 대화를 드래그해 복사하면 "나의 말:" / "ChatGPT의 말:"(영문 "You said:" / "ChatGPT said:") 줄로 나뉜다.
   그 표시가 있을 때만 나눈다. 질문 = 첫 번째 내 말, 답변 = AI 답변 전체(여러 번이면 이어 붙임). */
const USER_MARK = /^\s*(나의 말|내 말|You said|사용자|User|질문)\s*[:：]?\s*$/i;
const AI_MARK = /^\s*(ChatGPT의 말|ChatGPT said|ChatGPT|Gemini의 응답|Gemini said|Gemini|Claude|Copilot said|Copilot|Perplexity|뤼튼|DeepSeek|딥시크|답변)\s*[:：]?\s*$/i;
const UI_JUNK = /^\s*(ChatGPT는 실수를 할 수 있습니다|ChatGPT can make mistakes|출처$|Sources$|복사$|Copy$|공유하기$|Share$)/i;
const TOOL_OF = (mark) => {
  const m = mark.toLowerCase();
  if (m.includes('chatgpt')) return 'ChatGPT';
  if (m.includes('deepseek') || m.includes('딥시크')) return 'DeepSeek';
  if (m.includes('gemini')) return 'Gemini';
  if (m.includes('claude')) return 'Claude';
  if (m.includes('copilot')) return 'Microsoft Copilot';
  if (m.includes('perplexity')) return 'Perplexity';
  if (m.includes('뤼튼')) return '뤼튼';
  return null;
};
function parseConversation(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  if (!lines.some((l) => USER_MARK.test(l)) || !lines.some((l) => AI_MARK.test(l))) return null;
  const turns = [];
  let cur = null;
  let tool = null;
  for (const line of lines) {
    if (USER_MARK.test(line)) { cur = { role: 'user', lines: [] }; turns.push(cur); continue; }
    if (AI_MARK.test(line)) { tool ||= TOOL_OF(line.replace(/[:：]/g, '')); cur = { role: 'ai', lines: [] }; turns.push(cur); continue; }
    if (!cur || UI_JUNK.test(line) || /^\s*https:\/\/(?:chatgpt\.com|chat\.openai\.com)\/share\/\S+\s*$/.test(line)) continue;
    cur.lines.push(line);
  }
  const textOf = (t) => t.lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const users = turns.filter((t) => t.role === 'user').map(textOf).filter(Boolean);
  const ais = turns.filter((t) => t.role === 'ai').map(textOf).filter(Boolean);
  if (!ais.length) return null;
  const share = (String(text).match(/https:\/\/(?:chatgpt\.com|chat\.openai\.com)\/share\/[\w-]+/) || [])[0] || '';
  return { question: users[0] || '', answer: ais.join('\n\n'), tool, turns: users.length, share };
}

// 2단계 힌트 카드: 회차 기록 2회 이하면 펼쳐서, 3회차부터는 항목 제목만(‘자세히’로 펼침)
const HINTS = [
  { title: '숫자·날짜·제도가 나온다', words: '%, ○명, ○년, ○월, 법·제도·가이드라인 이름', fail: '그럴듯한 숫자를 만들거나, 바뀌기 전의 날짜·제도를 말해요', check: '숫자는 원자료의 표에서, 날짜·제도는 지금 기준 공식 사이트에서' },
  { title: '논문이나 책을 말한다', words: '"○○의 연구에 따르면", 저자 이름(연도), 《책 제목》, 학술지 이름', fail: '없는 논문을 지어내거나, 있는 논문의 저자·학술지·연도를 틀려요', check: '학술 DB에서 제목으로 찾고, 저자·학술지·연도까지 맞는지 보기' },
  { title: '인물이나 기관의 발언을 옮긴다', words: '"~가 밝혔다", "~에 따르면", 기관·회사 이름', fail: '말한 사람이나 기관을 바꿔 적어요', check: '기사나 요약 말고 그 기관의 원래 발표문으로 가서 확인' },
];
// 유형별 '이렇게 확인해요' (힌트 카드 문구와 같게. 권장 유형은 짧은 확인 방법)
const CHECK_OF = {
  '통계·수치': HINTS[0].check, '날짜·법령': HINTS[0].check,
  '논문·책 인용': HINTS[1].check, '인물·기관 발언': HINTS[2].check,
  '인과관계': '다른 원인은 없는지, 근거 연구가 있는지 보기',
  '일반화': '어떤 조사에서 몇 명을 대상으로 한 말인지 찾아보기',
  '최신 동향': '최근 날짜의 자료로 지금 기준인지 확인하기',
};
function missedBlock() {
  const pending = pendingOf(prevEntry(store.get(HISTORY_KEY, [])));
  if (!pending.length) return '';
  return `<div class="missed-block">
    <strong>지난번 내가 놓친 것</strong>
    <ul>${pending.map((p) => `
      <li><div class="mb-head"><b>${esc(p.type)}</b> · ${p.count}개 놓침${p.streak >= 2 ? ` <em>${p.streak}회 연속 놓침</em>` : ''}</div>
        ${p.example ? `<div class="mb-ex">"${esc(p.example)}"</div>` : ''}
        ${CHECK_OF[p.type] ? `<div class="mb-check">이렇게 확인해요: ${esc(CHECK_OF[p.type])}</div>` : ''}</li>`).join('')}
    </ul>
  </div>`;
}

// 이번 회차에 놓친 것(3단계 결과가 나온 뒤 2단계로 돌아오면 보인다)
const HINT_OF_TYPE = { '통계·수치': 0, '날짜·법령': 0, '논문·책 인용': 1, '인물·기관 발언': 2 };
function currentMissedBlock(a) {
  const missed = missedByType(a);
  const prev = pendingOf(prevEntry(store.get(HISTORY_KEY, [])));
  if (!missed.length) return `<div class="missed-block now"><strong>이번에 내가 놓친 것</strong><p class="mb-none">놓친 문장이 없어요. 확인이 필요한 ${a.flagged.length}개를 모두 먼저 찾았어요.</p></div>`;
  return `<div class="missed-block now">
    <strong>이번에 내가 놓친 것 <span class="muted small">AI 표시와 비교한 결과 · 아래 문장에 ✓·▲ 표시</span></strong>
    <ul>${missed.map((m) => `
      <li><div class="mb-head"><b>${esc(m.type)}</b> · ${m.count}개 놓침${prev.some((p) => p.type === m.type) ? ' <em>지난번에도 놓침</em>' : ''}</div>
        ${m.example ? `<div class="mb-ex">"${esc(m.example)}"</div>` : ''}
        ${CHECK_OF[m.type] ? `<div class="mb-check">이렇게 확인해요: ${esc(CHECK_OF[m.type])}</div>` : ''}</li>`).join('')}
    </ul>
  </div>`;
}

// 비교 전(after=false): 힌트 카드는 숨기고, 지난번 놓친 것만(있으면) 보여 준다.
// 비교 후(after=true): 이번에 놓친 것 + 힌트 카드(놓친 유형 항목만 펼침).
function hintCard(after = false) {
  if (!after) {
    const mb = missedBlock();
    return mb ? `<div class="panel tint hint-card hint-main">${mb}</div>` : '';
  }
  const a = analysis();
  const hit = new Map();
  for (const m of missedByType(a)) if (HINT_OF_TYPE[m.type] != null) hit.set(HINT_OF_TYPE[m.type], (hit.get(HINT_OF_TYPE[m.type]) || 0) + m.count);
  return `<div class="panel tint hint-card hint-main">
    ${currentMissedBlock(a)}
    <strong>이런 문장은 확인하고 써야 해요</strong>
    <ol class="hint-list">${HINTS.map((h, i) => `
      <li class="${hit.has(i) ? 'hit' : ''}"><details ${hit.has(i) ? 'open' : ''}><summary><span class="hint-no">${'①②③'[i]}</span> ${esc(h.title)}${hit.has(i) ? `<span class="hint-hit">이번에 ${hit.get(i)}개 놓침</span>` : ''}<span class="hint-more">자세히</span></summary>
        <dl>
          <dt>이런 말</dt><dd>${esc(h.words)}</dd>
          <dt>AI는 이렇게 틀려요</dt><dd>${esc(h.fail)}</dd>
          <dt>이렇게 확인해요</dt><dd>${esc(h.check)}</dd>
        </dl></details></li>`).join('')}
    </ol>
    <p class="hint-also">한 번 더 보면 좋은 말: "대부분", "항상", "~때문에", "최근" → 근거 없이 넓게 말하거나, 지난 정보일 수 있어요</p>
    <p class="hint-ref">근거: Huang et al.(2025) 환각 분류, Walters &amp; Wilder(2023), Wineburg &amp; McGrew(2019)</p>
  </div>`;
}

function viewStep2() {
  const locked = !!state.ai;
  const head = `<h2>2. 먼저 의심하기</h2>
  ${locked
    ? `<p class="lead">AI 표시와 비교한 결과예요. 내가 놓친 문장과 확인 방법을 위에 정리했어요. 처음 고른 형광펜은 바꿀 수 없어요${state.doubtLog ? ` (${fmtTime(state.doubtLog.at)} 기록)` : ''}.</p>`
    : `<p class="lead"><strong>${hasCandidates() ? `AI 답변 전문(${state.sentences.length}문장)에서 확인해 볼 만한 문장 ${visibleSentences().length}개를 골랐어요. 의심되는 부분에 형광펜을 그어 보세요.` : '확인하고 써야 할 부분에 형광펜을 그어 보세요.'}</strong></p>`}`;
  if (state.candidatesPending) {
    return splitView(head, `<div class="panel skel" aria-busy="true"><p class="skel-msg">문장을 선별하고 있어요…</p>${'<div class="skel-line"></div><div class="skel-line short"></div>'.repeat(MAX_CANDIDATES)}</div>`, `<div class="side-nav"><button class="small-btn" data-action="go" data-step="1">← 이전</button><span class="nav-status">문장을 선별하고 있어요…</span></div>`);
  }
  const main = `
  ${hintCard(locked)}
  <div class="panel">
    <div class="answer selectable${locked ? ' locked' : ''}" id="answer-select">${renderAnswer('select')}</div>
  </div>`;
  const side = `
  <div class="side-nav">
    <button class="small-btn" data-action="go" data-step="1">← 이전</button>
    <span class="nav-status" id="sel-count">${selCountText()}</span>
    <button class="primary small-btn" data-action="to-3">${locked ? 'AI 표시 다시 보기 →' : 'AI 표시와 비교하기 →'}</button>
  </div>
  ${locked ? '' : `<p class="muted side-text">단어나 구절을 마우스로 드래그하면 노란 형광펜이 그어지고, 그은 곳을 다시 누르면 지워져요. 맞는지 틀린지 몰라도 괜찮아요. 형광펜을 그은 문장 아래에서 이유도 골라 보세요(여러 개, 선택).</p>`}
`;
  return splitView(head, main, side);
}

// 3단계 오른쪽: 고른 문장의 상세 (등급·유형은 여기서만 보인다)
let activeId = null;
function claimDetail(id, a) {
  const s = state.sentences.find((x) => x.id === id);
  if (!s) return '<p class="muted small" style="margin:0">답변에서 문장을 누르면 AI 조교의 한마디와 검색어가 여기에 나와요.</p>';
  const it = a.byId.get(id) || { level: 'info', types: [], reason: '', media: [], keywords: [] };
  const lv = LEVEL[it.level];
  const n = a.number.get(id);
  return `
    <p class="ai-level"><span class="muted">${n ?? '·'}번</span> AI 표시 <b class="lv-text">${lv.label}</b>${typesOf(it).length ? ` · ${esc(typesOf(it).join(', '))}` : ''}</p>
    ${it.origLevel ? `<p class="small muted trim-note">AI는 '${LEVEL[it.origLevel].label}'로 봤지만, 이번에는 더 중요한 ${MAX_TARGETS}개만 확인해요. 보고서에 쓸 문장이면 직접 확인하세요.</p>` : ''}
    ${predictionBlock(id, it, a)}
    ${tipBlock(id, it)}
    ${searchBlock(it, id)}`;
}

function predictionBlock(id, it, a) {
  if (!a.sel.has(id)) return '';
  const r = reasonText(id);
  const types = typesOf(it);
  let cmp = '';
  if (manualTypesOf(id).length) { // 자동으로 켜진 칩만 있으면 비교하지 않는다(지표와 같은 기준)
    if (reasonMatches(id, it)) cmp = ''; // 같으면 AI 조교의 한마디에 한 줄로만 말한다(tipBlock)
    else {
      const t = mainType(it);
      cmp = t ? `<span>AI는 '${esc(t)}'${josa(t, '으로/로')} 봤어요</span>` : '<span>AI는 이 문장의 유형을 분류하지 않았어요</span>';
      const kept = !!state.keepMine?.[id];
      cmp += ` <button type="button" class="small-btn keep ${kept ? 'on' : ''}" data-action="keep-mine" data-id="${id}" aria-pressed="${kept}">${kept ? '✓ 내 판단 유지함' : '내 판단 유지'}</button>`;
    }
  }
  const hl = markTexts(id).filter(Boolean);
  const hlHtml = hl.length ? `<span class="pred-hl">내 형광펜 ${hl.map((t) => `<mark class="hl">${esc(t)}</mark>`).join(' ')}</span>` : '';
  return `<div class="pred">${hlHtml}<span class="pred-mine">내 예측: ${r ? esc(r) : '고르지 않음'}</span>${cmp}</div>`;
}

function tipBlock(id, it) {
  const types = [...typesOf(it)];
  if (state.keepMine?.[id]) for (const t of reasonTypesOf(id)) if (!types.includes(t)) types.push(t);
  const tips = [...new Set(types.map((t) => TIP[t]).filter(Boolean))].slice(0, 3);
  if (!tips.length) return '';
  const same = state.ai && state.selected.includes(id) && manualTypesOf(id).length && reasonMatches(id, it);
  return `<div class="tip"><b>AI 조교의 한마디</b>${same ? '<p class="tip-same">고른 이유도 AI와 같아요</p>' : ''}${tips.map((t) => `<p>${esc(t)}</p>`).join('')}</div>`;
}

let pendingReveal = false;
let revealing = false;
let revealTimers = [];
const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function viewStep3() {
  const head3 = '<h2>3. AI 표시와 비교</h2>';
  if (loading) {
    return `${head3}<div class="loading"><div class="spinner"></div>Gemini가 문장마다 주장 유형을 분류하고 있습니다. 참·거짓은 판정하지 않습니다.</div>`;
  }
  if (!state.ai) {
    return `${head3}
      <div class="error"><strong>AI 분류를 받지 못했습니다.</strong><br>${esc(lastError || '')}</div>
      <div class="actions">
        <button data-action="go" data-step="2">← 이전</button>
        <span class="spacer"></span>
        ${cachedExample(state.answer) ? '<button data-action="use-demo-result">저장된 결과로 계속</button>' : ''}
        <button class="primary" data-action="retry">다시 시도</button>
      </div>`;
  }
  const a = analysis();
  const N = a.flagged.length;
  if (activeId == null || !state.sentences.some((s) => s.id === activeId)) activeId = a.missed[0] ?? a.flagged[0] ?? null;
  const head = `${head3}
  <p class="lead">AI는 '어디를 확인할지'만 표시합니다. 맞는지 틀린지는 다음 단계에서 여러분이 출처로 판단합니다.</p>`;
  const main = `
  <div class="panel">
    ${LEGEND_HTML}
    <hr class="rule">
    <div class="answer compare" id="answer-compare">${renderAnswer('compare')}</div>
    <p class="small muted" style="margin:0">문장을 누르면 AI 조교 패널에 한마디와 검색어가 나와요. · 분류: ${esc(state.ai.model)} · 프롬프트 ${esc(state.ai.promptVersion)}</p>
  </div>`;
  const side = `
  <div class="side-nav">
    <button class="small-btn" data-action="go" data-step="2">← 이전</button>
    <span class="spacer"></span>
    <button class="primary small-btn" data-action="go" data-step="4">다음: 직접 검증하기 →</button>
  </div>
  <div class="reveal-summary compact" id="reveal-summary">
    <div class="sum-body">
      ${N ? `<span class="big"><span id="count-p">${a.ratio}</span><small>%</small></span>
      <div><div class="msg">${N}개 중 <span id="count-m">${a.first.length}</span>개를 먼저 찾았어요</div><span class="sub">먼저 의심한 비율</span></div>`
      : '<div class="msg">AI가 확인 필요로 표시한 문장이 없어요</div>'}
    </div>
    <button class="small-btn replay" data-action="replay">다시 보기</button>
  </div>
  <div id="cmp-groups">
    ${a.missed.length ? `<div class="panel side-list">
      <h4><i class="g mk">${PEN.chk}</i> 놓친 주장 ${a.missed.length}개 <span class="muted small">왜 놓쳤는지 생각해 보세요</span></h4>
      <div class="pick-row">${a.missed.map((id) => `<button type="button" class="pick ${id === activeId ? 'on' : ''}" data-pick="${id}" title="${esc(state.sentences.find((s) => s.id === id)?.text)}"><b>${a.number.get(id)}</b> ${esc(typesOf(a.byId.get(id)).join(' · '))}</button>`).join('')}</div>
    </div>` : '<div class="panel tint small">놓친 주장이 없어요.</div>'}
    <div class="panel side-detail" id="side-detail">${claimDetail(activeId, a)}</div>
  </div>`;
  return splitView(head, main, side, 'swap'); // 넓은 화면: 왼쪽 = AI 조교 패널, 오른쪽 = 문장 목록(2026-11-24 정태)
}

/* 3단계 공개 장면: 밑줄 → 배지 도장 → 요약 카운트업 (전체 2초 이내, 한 번에 한 영역) */
let revealGen = 0;
function clearReveal() {
  revealGen++;
  revealTimers.forEach(clearTimeout);
  revealTimers = [];
  revealing = false;
}

function runReveal() {
  clearReveal();
  const root = document.getElementById('answer-compare');
  if (!root || reducedMotion()) return; // 줄인 동작 설정이면 최종 상태 그대로
  const summaryBody = document.querySelector('#reveal-summary .sum-body');
  const replay = document.querySelector('#reveal-summary .replay');
  const groups = document.getElementById('cmp-groups');
  const later = (fn, ms) => revealTimers.push(setTimeout(fn, ms));
  const sents = [...root.querySelectorAll('.sent')];

  revealing = true;
  root.classList.remove('stamped');
  sents.forEach((el) => el.classList.remove('drawn', 'open'));
  root.classList.add('pre-reveal');
  [summaryBody, replay, groups].forEach((el) => el?.classList.add('is-hidden'));
  ['count-m', 'count-p'].forEach((id) => { const el = document.getElementById(id); if (el) el.textContent = '0'; });
  void root.offsetWidth; // 초기 상태를 먼저 그린다

  // 1) 위에서 아래로 밑줄 (간격 최대 100ms, 시작은 500ms 안에)
  const gap = Math.min(100, 500 / Math.max(1, sents.length));
  sents.forEach((el, i) => later(() => el.classList.add('drawn'), i * gap));
  const tDrawn = (sents.length - 1) * gap + 550; // 밑줄 400 + 바탕 150

  // 2) 배지 도장(200ms) + 놓친 확인 필수 한 번 깜빡임(300ms)
  later(() => root.classList.add('stamped'), tDrawn);

  // 3) 요약 카운트업 500ms
  later(() => {
    summaryBody?.classList.remove('is-hidden');
    const m = document.getElementById('count-m');
    const p = document.getElementById('count-p');
    const a = analysis();
    const t0 = performance.now();
    const gen = revealGen;
    const tick = (now) => {
      if (gen !== revealGen) return; // 다시 보기·화면 전환으로 취소됨
      const k = Math.min(1, (now - t0) / 500);
      if (m) m.textContent = Math.round(a.first.length * k);
      if (p) p.textContent = Math.round(a.ratio * k);
      if (k < 1) { requestAnimationFrame(tick); return; }
      replay?.classList.remove('is-hidden');
      groups?.classList.remove('is-hidden');
      revealing = false;
    };
    requestAnimationFrame(tick);
  }, tDrawn + 300);
}

function openCard(id) {
  id = Number(id);
  activeId = id;
  const a = analysis();
  const box = document.getElementById('side-detail');
  if (box) box.innerHTML = claimDetail(id, a);
  document.querySelectorAll('#cmp-groups .pick').forEach((b) => b.classList.toggle('on', Number(b.dataset.pick) === id));
  document.querySelectorAll('#answer-compare .sent.open').forEach((x) => x.classList.remove('open'));
  const sent = document.querySelector(`#answer-compare .sent[data-id="${id}"]`);
  sent?.classList.add('open');
  const r = sent?.getBoundingClientRect();
  if (r && (r.top < 0 || r.bottom > window.innerHeight)) sent.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' });
  if (box && window.innerWidth < 1200) box.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
}

/* ---------- 4단계: 문제 찾고 고치기 ---------- */
const PROBLEM_FIELDS = ['problem', 'cross', 'fix'];
const fixModeOf = (v) => (FIX_MODES.includes(v?.fixMode) ? v.fixMode : 'fix');
// 삭제는 정정 칸이 필요 없다
const requiredFields = (v) => (fixModeOf(v) === 'delete' ? ['problem', 'cross'] : PROBLEM_FIELDS);
const fixText = (v) => (fixModeOf(v) === 'delete' ? '삭제' : (v?.fix || '').trim());

// [문제 발견] 값이 원문에 그대로 있으면 교정 부호(빨간 취소선 + 위에 정정 값)를 붙인다.
function markedQuote(text, v) {
  const part = (v?.problem || '').trim();
  if (v?.verdict !== 'problem' || !part || !text.includes(part)) return esc(text);
  const i = text.indexOf(part);
  return `${esc(text.slice(0, i))}<ruby class="fix-mark"><del>${esc(part)}</del><rt>${esc(fixText(v))}</rt></ruby>${esc(text.slice(i + part.length))}`;
}

// 4단계: 왼쪽 = 문장 카드, 오른쪽 = 고른 카드의 입력칸
function verifyInputs(id, a, vs) {
  const s = state.sentences.find((x) => x.id === id);
  const v = state.verify[id] || {};
  const isProblem = v.verdict === 'problem';
  const unused = v.verdict === 'unused';
  const i = a.targets.indexOf(id);
  const nextId = a.targets.slice(i + 1).concat(a.targets.slice(0, i)).find((x) => !state.verify[x]?.verdict) ?? a.targets[i + 1];
  return `
    <div class="quote one-line" title="${esc(s?.text)}"><b class="muted">${a.number.get(id)}번</b> ${esc(s?.text)}</div>
    <div class="verdicts" role="radiogroup" aria-label="판정">
      ${Object.entries(VERDICT).map(([k, t]) => `<label><input type="radio" name="v-${id}" value="${k}" data-verify="${id}" data-field="verdict" ${v.verdict === k ? 'checked' : ''}><span class="v-${k}">${t}</span></label>`).join('')}
    </div>
    ${isProblem ? `
    <div class="problem-fields">
      <div class="fix-modes" role="radiogroup" aria-label="정정 방식"><span class="chip-label">정정 방식</span>
        ${FIX_MODES.map((k) => `<label><input type="radio" name="m-${id}" value="${k}" data-verify="${id}" data-field="fixMode" ${fixModeOf(v) === k ? 'checked' : ''}><span>${FIX_MODE_LABEL[k]}</span></label>`).join('')}
      </div>
      <div class="grid-2">
        <label class="field"><span>문제 발견 <em>필수</em></span>
          <input type="text" data-verify="${id}" data-field="problem" value="${esc(v.problem)}" maxlength="120" placeholder="실제와 다른 표현 (원문 그대로)"></label>
        ${fixModeOf(v) === 'delete' ? '<p class="small muted fix-del-note">삭제: 이 내용을 보고서에서 빼요. 정정 칸은 쓰지 않아도 돼요.</p>' : `<label class="field"><span>${fixModeOf(v) === 'soften' ? '완화한 표현' : '정정'} <em>필수</em></span>
          <input type="text" data-verify="${id}" data-field="fix" value="${esc(v.fix)}" maxlength="200" placeholder="${fixModeOf(v) === 'soften' ? '예: ~라는 우려가 있다' : '고친 표현'}"></label>`}
      </div>
      <label class="field"><span>교차 검증 <em>필수 · 자료 이름과 함께 URL 또는 DOI를 넣어 주세요</em></span>
        <input type="text" data-verify="${id}" data-field="cross" value="${esc(v.cross)}" maxlength="300" placeholder="예: CJ ENM 2025 실적 발표 https://… / Walters(2023) 10.1038/s41598-023-41032-5">
        <span class="cross-hint" id="cross-hint-${id}">${crossHint(v.cross)}</span></label>
      <div class="grid-2">
        <label class="field"><span>반영 위치 <em>선택</em></span>
          <input type="text" data-verify="${id}" data-field="location" value="${esc(v.location)}" maxlength="80" placeholder="예: 2장 첫 문단"></label>
      </div>
    </div>` : ''}
    ${isProblem || unused || !v.verdict ? '' : `
    <div class="verify-grid">
      <label class="field" style="margin:0"><span>확인한 자료 <em>선택 · 자료명·URL</em></span>
        <input type="text" data-verify="${id}" data-field="source" value="${esc(v.source)}" maxlength="300"></label>
      <label class="field" style="margin:0"><span>자료 종류</span>
        <select data-verify="${id}" data-field="media">
          <option value="">선택</option>
          ${Object.entries(MEDIA).map(([k, t]) => `<option value="${k}" ${v.media === k ? 'selected' : ''}>${t}</option>`).join('')}
          <option value="other" ${v.media === 'other' ? 'selected' : ''}>기타(뉴스·웹 등)</option>
        </select></label>
    </div>`}
    ${nextId != null && nextId !== id ? `<div class="actions" style="margin-top:.8rem"><span class="spacer"></span><button type="button" data-action="pick4" data-id="${nextId}">다음 문장 ${a.number.get(nextId)} →</button></div>` : ''}`;
}

let active4 = null;
// 시연용 예시(친구 답변)는 정답표 기준 샘플 판정을 처음 한 번 채운다(학생이 고칠 수 있음)
// [샘플 데이터 채우기] 버튼을 눌렀을 때만(시연용 예시). 이미 적은 판정도 샘플로 덮어쓴다.
function applySampleVerify(a) {
  const sample = cachedExample(state.answer)?.sampleVerify;
  if (!sample) return false;
  for (const id of a.targets) if (sample[id]) state.verify[id] = { ...sample[id] };
  state.sampleApplied = true;
  // '문제 있음' 문장을 열어 채워진 칸을 바로 보여 준다
  active4 = a.targets.find((id) => sample[id]?.verdict === 'problem') ?? active4;
  save();
  return true;
}

function viewStep4() {
  const a = analysis();
  const vs = verifyStats(a);
  const head = `<h2>4. 문제 찾고 고치기</h2>
  <p class="lead">왼쪽에서 문장을 고르고, 오른쪽에서 <b>'확인함'</b>, <b>'문제 있음'</b>, <b>'안 씀'</b> 중 하나를 누르세요. 문제만 자세히 적으면 됩니다.</p>
  ${state.sampleApplied && cachedExample(state.answer)?.sampleVerify ? '<p class="sample-note">샘플 데이터(정답표 기준)를 채웠어요. 고쳐도 돼요.</p>' : ''}`;
  if (!a.targets.length) {
    return `${head}<div class="panel tint">확인할 주장이 없습니다. 다음 단계로 넘어가세요.</div>
    <div class="actions"><button data-action="go" data-step="3">← 이전</button><span class="spacer"></span><button class="primary" data-action="to-5">증빙서 미리보기 →</button></div>`;
  }
  if (!a.targets.includes(active4)) active4 = a.targets.find((x) => !state.verify[x]?.verdict) ?? a.targets[0];
  const cards = a.targets.map((id) => {
    const s = state.sentences.find((x) => x.id === id);
    const it = a.byId.get(id) || { level: 'info', types: [], media: [], keywords: [] };
    const v = state.verify[id] || {};
    const lv = LEVEL[it.level];
    const flagged = a.flagged.includes(id);
    const mk = markOf(it.level, a.sel.has(id));
    const g = mk.g ? `<span title="${mk.label}">${mk.g}</span>` : '<i class="g"></i>';
    const unused = v.verdict === 'unused';
    const STATUS = { ok: '✓ 확인함', problem: '문제 있음', unused: '안 씀' };
    const status = `<span class="status s-${v.verdict || 'none'}">${v.verdict ? STATUS[v.verdict] : '아직'}</span>`;
    return `
    <article class="card vcard ${v.verdict ? 'done' : ''} ${unused ? 'unused' : ''} ${id === active4 ? 'active' : ''}" data-card="${id}" tabindex="0" aria-label="${a.number.get(id)}번 문장 고르기">
      <div class="vhead">${g}<b>${a.number.get(id)}</b><span>· ${esc(typesOf(it).join(' · ') || lv.label)}</span><span class="src-no">원문 ${id}번째 문장</span>${status}</div>
      <div class="quote" id="quote-${id}"><span class="sent lv-${it.level}">${markedQuote(s?.text || '', v)}</span></div>
      ${unused ? '' : searchBlock(it, id)}
    </article>`;
  }).join('');
  const main = `
  <div class="main-legend">${LEGEND_HTML}<p class="small muted">같은 AI에게 다시 묻는 것은 확인이 아닙니다. 자료를 직접 찾아 대조하세요.</p></div>
  ${cards}`;
  const side = `
  <div class="side-nav">
    <button class="small-btn" data-action="go" data-step="3">← 이전</button>
    <div class="side-progress">
      <div class="small" id="verify-progress-label" style="font-weight:700">${progressLabel(vs)}</div>
      <div class="progress"><i id="verify-progress" style="width:${pct(vs.seen, vs.total)}%"></i></div>
    </div>
    <button class="primary small-btn" data-action="to-5">증빙서 미리보기 →</button>
  </div>
  ${cachedExample(state.answer)?.sampleVerify ? '<div class="sample-bar"><button type="button" class="small-btn" data-action="fill-sample">샘플 데이터 채우기</button><span class="muted small">정답표 기준 판정·문제 있음 칸을 채워요</span></div>' : ''}
  <div class="panel side-detail" id="verify-side">${verifyInputs(active4, a, vs)}</div>
  ${vs.problem === 0 ? `
  <div class="panel">
    <label class="field" style="margin:0"><span>대조한 자료 <em>문제를 찾지 못했다면, 무엇과 대조했는지 (자료명·URL)</em></span>
      <input type="text" data-bind="compared" value="${esc(state.compared)}" maxlength="300"></label>
  </div>` : ''}`;
  return splitView(head, main, side);
}

const progressLabel = (vs) => `확인 ${vs.ok} · 문제 ${vs.problem} · 안 씀 ${vs.unused} / ${vs.total}`;

/* ---------- 5단계: 증빙서 미리보기 ---------- */
function reportSections(a) {
  return buildReport({
    meta: { ...state.meta, tool: toolName() },
    answer: state.answer,
    conclusion: state.conclusion,
    compared: state.compared,
    ratio: a.ratio,
    // no = 원문 몇 번째 문장 (4단계 카드의 '원문 n번째'와 같은 번호)
    items: a.targets.map((id) => ({ no: id, text: state.sentences.find((s) => s.id === id)?.text ?? '', ...(state.verify[id] || {}) })),
  });
}

// 증빙서 화면에서 URL을 누를 수 있게 (복사되는 글은 그대로 평문)
const linkify = (escaped) => escaped.replace(/https?:\/\/[^\s<>"'()\[\]]+[^\s<>"'()\[\].,;:!?。]/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
function reportBlocksHtml(a) {
  return reportSections(a).map((s) => `
    <section class="report-sec" data-sec="${s.key}">
      <div class="report-head"><h4>${esc(s.title)}</h4><button class="ghost no-print" data-action="copy-sec" data-key="${s.key}">복사</button></div>
      <pre class="report-body">${linkify(esc(s.body))}</pre>
    </section>`).join('');
}

// 4단계 교차 검증 칸 아래 안내: 링크를 알아봤는지 바로 보여 준다
function crossHint(v) {
  const t = String(v || '').trim();
  if (!t) return 'URL 또는 DOI를 넣으면 증빙서에서 바로 열 수 있는 링크가 돼요.';
  const link = linkOf(t);
  return link ? `<span class="ok">✓ 링크 인식: ${esc(link.replace(/^https?:\/\//, '').slice(0, 60))}</span>` : '<span class="warn">링크가 없어요. 증빙서에 "(URL 또는 DOI 작성 필요)"로 표시돼요.</span>';
}

/* ---------- 힌트 카드 개인화: 지난번 놓친 유형 ----------
   놓친 문장 = AI 확인 필수·권장인데 학생이 고르지 않은 문장. 문장마다 첫 번째 유형으로 묶는다.
   pending = 아직 '졸업'하지 못한 유형(이번에 놓쳤거나, 전에 놓쳤는데 이번에 그 유형 문장을 먼저 고르지 못한 것).
   졸업 = 지난번 pending 유형의 문장을 이번에 먼저 고름 → 다음 힌트 카드에서 빠진다. */
const ex40 = (t) => (t.length > 40 ? `${t.slice(0, 40)}…` : t);
function missedByType(a) {
  const g = new Map();
  for (const id of a.missed) {
    const t = mainType(a.byId.get(id));
    if (!t) continue;
    const cur = g.get(t) || { type: t, count: 0, example: ex40(state.sentences.find((s) => s.id === id)?.text || '') };
    cur.count++;
    g.set(t, cur);
  }
  return [...g.values()];
}
// 시연 기록(demo: 시연 모드나 [샘플 데이터 채우기])은 힌트 카드·놓친 유형 이어가기 계산에서 뺀다
const prevEntry = (hist) => hist.filter((h) => h.id !== state.sessionId && !h.demo).at(-1) || null;
const pendingOf = (h) => (Array.isArray(h?.pending) ? h.pending : Array.isArray(h?.missed) ? h.missed : []);
function missedSummary(a, hist) {
  const prev = pendingOf(prevEntry(hist));
  const firstTypes = new Set(a.first.flatMap((id) => typesOf(a.byId.get(id))));
  const graduated = prev.filter((p) => firstTypes.has(p.type)).map((p) => p.type);
  const missed = missedByType(a);
  const pending = [
    ...missed.map((m) => ({ ...m, streak: (prev.find((p) => p.type === m.type)?.streak || 0) + 1 })),
    ...prev.filter((p) => !graduated.includes(p.type) && !missed.some((m) => m.type === p.type)),
  ];
  return { missed, pending, graduated };
}

// 5단계 지표 아래: 이번에 놓친 유형 / 지난번 놓쳤는데 이번엔 찾은 유형
function missedNote(entry) {
  if (!entry) return '';
  const missed = entry.missed || [];
  const lines = [];
  for (const t of entry.graduated || []) lines.push(`<p class="mn-grad">지난번엔 놓쳤는데 이번엔 찾았어요 ✓ ${esc(t)}</p>`);
  lines.push(missed.length
    ? `<p class="mn-miss">이번에 놓친 ${missed.map((m) => `${esc(m.type)} ${m.count}개`).join(', ')}는 다음 힌트 카드에 추가돼요.</p>`
    : '<p class="mn-miss">이번엔 놓친 유형이 없어요.</p>');
  return `<div class="missed-note">${lines.join('')}</div>`;
}

function recordHistory(a, vs) {
  if (!state.sessionId || !state.ai) return;
  const hist = store.get(HISTORY_KEY, []);
  const ms = missedSummary(a, hist);
  const entry = {
    id: state.sessionId,
    date: state.meta.date || today(),
    savedAt: new Date().toISOString(),
    question: state.meta.question.slice(0, 80),
    tool: toolName(),
    picked: state.doubtLog?.ids.length ?? state.selected.length,
    pickedAt: state.doubtLog?.at || null,
    flagged: a.flagged.length,
    first: a.first.length,
    missedCount: a.missed.length,
    missed: ms.missed,       // [{type, count, example}] 이번에 놓친 유형
    pending: ms.pending,     // 다음 힌트 카드에 나올 유형(졸업 전까지 이어짐, streak = 연속 놓친 회차)
    graduated: ms.graduated, // 지난번 놓쳤는데 이번에 먼저 찾은 유형
    extra: a.extra.length,
    ratio: a.ratio,
    predicted: a.predicted.length,
    reasonMatched: a.matched.length,
    reasonRatio: a.reasonRatio,
    keepMine: Object.keys(state.keepMine || {}).length,
    targets: vs.total,
    ok: vs.ok,
    problem: vs.problem,
    unused: vs.unused,
    unseen: vs.unseen,
    sources: vs.sources,
    mediaUsed: vs.mediaUsed,
    demo: !!(state.ai.model?.startsWith('시연') || state.sampleApplied), // 샘플 데이터를 채운 실행도 시연 기록
    nextPrompt: nextText(a),
    nextConds: Object.keys(NEXT_COND).filter((k) => nextChecked(a)[k]),
  };
  const i = hist.findIndex((h) => h.id === entry.id);
  if (i >= 0) hist[i] = entry; else hist.push(entry);
  store.set(HISTORY_KEY, hist);
  return hist;
}

function applyAutoConclusion() {
  // 2026-11-26: 최종 결론은 학생이 '기억할 것'을 보고 직접 쓴다. 예전에 자동으로 넣은 결론이 남아 있으면 비운다.
  if (state.conclusionAuto && state.conclusion === state.conclusionAuto) { state.conclusion = ''; save(); }
  state.conclusionAuto = '';
}

function viewStep5() {
  const a = analysis();
  const vs = verifyStats(a);
  applyAutoConclusion(a, vs);
  const hist = recordHistory(a, vs) || store.get(HISTORY_KEY, []);
  const picked = state.doubtLog?.ids.length ?? state.selected.length;
  const sample = cachedExample(state.answer)?.sampleConclusion;
  // 5단계(2026-11-26 정태): 첫 화면 = 먼저 의심한 비율 + 다음 질문, 아래로 내리면 증빙서.
  // 증빙서 옆에서 '기억할 것'을 보며 최종 결론을 직접 쓴다(자동 결론·메모 칸 없음). 시연용 예시는 [샘플 결론 넣기].
  const head = `<div class="step-head s5-head"><h2>5. 증빙서 미리보기</h2>
    <div class="s5-nav no-print">
      <button class="small-btn" data-action="go" data-step="4">← 이전</button>
      <button class="primary small-btn" data-action="copy-all">증빙서 전체 복사</button>
    </div></div>`;
  const hero = `
  <section class="s5-hero" aria-label="이번 결과">
    <div class="s5-hero-grid">
      <div class="panel side-metrics s5-score" title="AI 표시 전에 고른 문장 ${picked}개 · 회차 기록은 이 브라우저에만 저장됩니다">
        <div class="stat hero big"><div class="k">AI 표시 전 먼저 의심한 비율</div><div class="v"><span id="ratio5">${a.ratio}</span><small>%</small></div><div class="k">확인이 필요한 ${a.flagged.length}개 중 ${a.first.length}개를 먼저 찾음</div></div>
        ${missedNote(hist.find((h) => h.id === state.sessionId))}
      </div>
      ${nextQuestionCard(a)}
    </div>
    <button type="button" class="s5-down no-print" data-action="to-doc">아래로 내려 최종 결론 쓰고 증빙서 보기 <span aria-hidden="true">↓</span></button>
  </section>`;
  const warn = vs.uncheckedMust.length ? `<div class="warn-must no-print">
    <strong>아직 보지 않은 확인 필수 주장 ${vs.uncheckedMust.length}개</strong>
    <ul style="margin:.4rem 0;padding-left:1.2rem">${vs.uncheckedMust.map((id) => `<li style="font-family:var(--serif)">${esc(state.sentences.find((s) => s.id === id)?.text)}</li>`).join('')}</ul>
    <button data-action="go" data-step="4">4단계로 돌아가기</button>
  </div>` : '';
  const doc = `
  ${warn}
  <div class="panel report">
    <div class="report-head"><h3>AI 활용 서면 증빙서</h3>
      <div class="doc-tools no-print" role="toolbar" aria-label="증빙서 내보내기">
        <button type="button" class="small-btn" data-action="copy-all">전체 복사</button>
        <button type="button" class="small-btn" data-action="print">인쇄 / PDF</button>
        <button type="button" class="small-btn" data-action="export">JSON</button>
      </div>
    </div>
    <div id="report-blocks">${reportBlocksHtml(a)}</div>
  </div>
  ${keepNote(a)}`;
  const write = `
  <div class="panel s5-conclude no-print">
    <div class="report-head"><h3>최종 결론 쓰기</h3>${sample ? '<button type="button" class="small-btn" data-action="sample-conclusion">샘플 결론 넣기</button>' : ''}</div>
    <p class="small muted s5-how">아래 '기억할 것'을 보고 내 말로 2~3문장을 쓰세요. 쓰는 대로 증빙서 4번 [최종 결론]에 들어가요.</p>
    <ol class="s5-guide">
      <li><b>그대로 쓸 것</b>은 출처와 함께 쓴다고 밝히기</li>
      <li><b>고친 것</b>은 고친 내용으로, <b>뺀 것</b>은 빼고 쓰기</li>
      <li>근거가 약한 주장은 <b>단정하지 않고</b>, 활용 목적 범위 안에서만 쓰기</li>
    </ol>
    <label class="field s5-field"><span>최종 결론 <em>직접 쓰기</em></span>
      <textarea data-bind="conclusion" rows="5" placeholder="예: …은 출처를 확인해 그대로 쓰고, …은 …(으)로 고쳐 쓴다. 확인되지 않은 …은 뺀다.">${esc(state.conclusion)}</textarea></label>
    <h4 class="s5-remember-title">기억할 것 <span class="muted small">검증 결과에서 모았어요</span></h4>
    <div class="remember" aria-label="보고서에 반영할 것">${rememberList(a)}</div>
  </div>`;
  return `${head}${hero}
  <div class="split swap s5-split" id="s5-doc">
    <div class="col-main">${doc}</div>
    <aside class="col-side" aria-label="최종 결론 쓰기">${write}</aside>
  </div>
  <div class="side-extra no-print s5-extra"><button class="small-btn" data-action="new">새로 시작</button></div>`;
}

// 이번 회차에 놓친 유형 + '문제 있음' 유형 → 제안할 조건 키
function suggestedConds(a) {
  const keys = new Set();
  const add = (id) => typesOf(a.byId.get(id)).forEach((t) => TYPE_COND[t] && keys.add(TYPE_COND[t]));
  a.missed.forEach(add);
  for (const id of a.targets) if (state.verify[id]?.verdict === 'problem') add(id);
  return keys;
}
function nextChecked(a) {
  if (state.nextQ?.checked) return state.nextQ.checked;
  const sug = suggestedConds(a);
  return Object.fromEntries(Object.keys(NEXT_COND).map((k) => [k, sug.has(k)]));
}
function composeNext(a) {
  const checked = nextChecked(a);
  const q = state.meta.question.trim() || '(원래 질문)';
  const conds = Object.keys(NEXT_COND).filter((k) => checked[k]).map((k) => `- ${NEXT_COND[k].text}`);
  return conds.length ? `${q}\n\n${conds.join('\n')}` : q;
}
const nextText = (a) => (state.nextQ?.text ?? composeNext(a));
function saveNextToHistory(a) {
  const hist = store.get(HISTORY_KEY, []);
  const h = hist.find((x) => x.id === state.sessionId);
  if (!h) return;
  h.nextPrompt = nextText(a);
  h.nextConds = Object.keys(NEXT_COND).filter((k) => nextChecked(a)[k]);
  store.set(HISTORY_KEY, hist);
}

function nextQuestionCard(a) {
  const sug = suggestedConds(a);
  const checked = nextChecked(a);
  const edited = state.nextQ?.text != null;
  return `<div class="panel next-q" id="next-q">
    <div class="report-head"><h3>다음 질문은 이렇게</h3><button class="primary" data-action="copy-next">복사</button></div>
    <p class="orig-q one-line" title="${esc(state.meta.question)}"><span class="muted small">원래 질문</span> ${esc(state.meta.question.trim() || '1단계에서 원래 질문을 적지 않았어요.')}</p>
    <p class="small muted" style="margin:.5rem 0 .3rem">덧붙일 조건 · <em class="em-brand">이번</em> 표시는 이번에 놓쳤거나 문제가 있던 유형</p>
    <ul class="cond-list">${Object.entries(NEXT_COND).map(([k, c]) => `
      <li><label title="${esc(c.text)}"><input type="checkbox" data-nextq="${k}" ${checked[k] ? 'checked' : ''}>
        <span>${esc(c.label)}${sug.has(k) ? ' <em>이번</em>' : ''}</span></label></li>`).join('')}
    </ul>
    <label class="field" style="margin:.6rem 0 0"><span>다음에 보낼 질문 <em>직접 고쳐도 돼요</em></span>
      <textarea id="next-text" data-nextq-text rows="5">${esc(nextText(a))}</textarea></label>
    <div class="actions next-actions" style="margin-top:.4rem">
      ${edited ? '<button class="ghost" data-action="next-reset">조건대로 다시 만들기</button>' : ''}
    </div>
    <p class="next-foot">좋은 질문은 검증을 없애 주지 않아요. 검증하기 쉬운 답을 받게 해 줄 뿐이에요.</p>
  </div>`;
}

// 5단계 '기억할 것': 검증 결과에서 결론·보고서에 반영할 것을 판정별로, 어떻게 쓰면 되는지까지
function rememberList(a) {
  const text = (id) => state.sentences.find((s) => s.id === id)?.text || '';
  const short = (t) => (t.length > 60 ? `${t.slice(0, 60)}…` : t);
  const linkA = (v) => { const l = linkOf(v.source) || linkOf(v.cross); return l ? `<a href="${esc(l)}" target="_blank" rel="noopener noreferrer" class="small">대조 자료 ↗</a>` : '<span class="small muted">대조 자료 링크 없음</span>'; };
  const HOW = {
    fix: (v) => { const t = fixText(v) || '(정정 미작성)'; return `결론·보고서에는 <b>${esc(t)}</b>${josa(t, '으로/로')} 고쳐 써요.`; },
    delete: () => '확인되지 않았으니 결론·보고서에서 <b>빼요</b>.',
    soften: (v) => `근거가 없으니 단정하지 말고 <b>‘${esc(fixText(v) || '(정정 미작성)')}’</b>처럼 약하게 써요.`,
  };
  const groups = { fixed: [], ok: [], unused: [], unseen: [] };
  for (const id of a.targets) {
    const v = state.verify[id] || {};
    if (v.verdict === 'problem') groups.fixed.push({ id, v });
    else if (v.verdict === 'ok') groups.ok.push({ id, v });
    else if (v.verdict === 'unused') groups.unused.push({ id, v });
    else groups.unseen.push({ id, v });
  }
  const sec = (title, desc, items) => (items.length ? `<h4>${title} <span class="muted small">${items.length}</span></h4><p class="rm-desc">${desc}</p><ul>${items.join('')}</ul>` : '');
  const html = [
    sec('고쳐서 반영할 것', '틀렸거나 확인되지 않은 부분이에요. 결론에 그대로 옮기면 안 돼요.', groups.fixed.map(({ id, v }) => `<li>
      <span class="muted small">원문 ${id}번째 문장 · ${esc(FIX_MODE_LABEL[fixModeOf(v)])}</span>
      <div class="rm-src">${esc(short(text(id)))}</div>
      <div><del>${esc(v.problem || '(문제 발견 미작성)')}</del>${fixModeOf(v) === 'delete' ? '' : ` → <b>${esc(fixText(v) || '(정정 미작성)')}</b>`}${v.location ? ` <span class="muted small">· ${esc(v.location)}</span>` : ''}</div>
      <p class="rm-how">${HOW[fixModeOf(v)](v)}</p>${linkA(v)}</li>`)),
    sec('확인하고 그대로 쓸 것', '자료와 대조해 맞았던 문장이에요. 쓸 때는 출처를 함께 밝혀요.', groups.ok.map(({ id, v }) => `<li>
      <span class="muted small">원문 ${id}번째 문장</span>
      <div class="rm-src">${esc(short(text(id)))}</div>${linkA(v)}</li>`)),
    sec('쓰지 않기로 한 문장', '보고서와 결론에 넣지 않아요.', groups.unused.map(({ id }) => `<li><span class="muted small">원문 ${id}번째 문장</span><div class="rm-src">${esc(short(text(id)))}</div></li>`)),
    sec('아직 확인하지 않은 문장', '확인하기 전에는 결론에 넣지 마세요. 쓰려면 4단계에서 먼저 확인해요.', groups.unseen.map(({ id }) => `<li><span class="muted small">원문 ${id}번째 문장</span><div class="rm-src">${esc(short(text(id)))}</div></li>`)),
  ].join('');
  return html || '<p class="muted small" style="margin:0">확인할 문장이 없어요.</p>';
}

function keepNote(a) {
  const ids = Object.keys(state.keepMine || {}).map(Number).filter((id) => a.sel.has(id));
  return `<div class="panel tint keep-note">
    <h4>내 판단 유지 ${ids.length}건</h4>
    ${ids.length ? `<ul>${ids.map((id) => `<li><span class="answer-inline">${esc(state.sentences.find((s) => s.id === id)?.text)}</span> — 내 예측 '${esc(reasonText(id))}', AI 분류 '${esc(typesOf(a.byId.get(id)).join(' · ') || '없음')}'</li>`).join('')}</ul>`
      : '<p class="small muted" style="margin:0">AI 분류와 다를 때 내 판단을 유지한 문장이 없습니다.</p>'}
  </div>`;
}

function countUp(el, to, ms = 500) {
  if (!el) return;
  if (reducedMotion()) { el.textContent = to; return; }
  const gen = revealGen;
  const t0 = performance.now();
  el.textContent = '0';
  const tick = (now) => {
    if (gen !== revealGen) return;
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = Math.round(to * k);
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/* ---------- 첫 화면: 펜으로 고쳐지는 답변 한 장 (2026-11-26) ----------
   처음 들어왔을 때(답변 비어 있음 + 아직 시작 전)만. 이미지 없이 SVG·CSS.
   손글씨는 고칠 구절(span.fx) 기준 em 단위로 놓여서 150% 확대에서도 같은 자리에 붙는다.
   그리는 순서는 style 의 --d(시작)·--t(길이)로, 전체 4.7초 · 반복 없음 · 줄인 동작이면 다 그려진 상태. */
// 왼쪽 위 '의심노트'를 누르면 언제든 첫 화면(introOpen). 하던 작업은 그대로 두고 [이어서 하기]로 돌아간다.
let introOpen = false;
const hasWork = () => !!state.answer.trim();
const showIntro = () => introOpen || (state.step === 1 && !state.introSeen && !hasWork());
function viewIntro() {
  // pathLength=1 → stroke-dasharray/offset 1 로 '그어지는' 효과
  const path = (d, delay, dur, cls = '') => `<path class="${cls}" pathLength="1" d="${d}" style="--d:${delay}s;--t:${dur}s"/>`;
  const svg = (cls, vb, paths) => `<svg class="ip ${cls}" viewBox="${vb}" preserveAspectRatio="none" aria-hidden="true" focusable="false">${paths}</svg>`;
  const hl = (delay) => svg('ip-hl', '0 0 100 20', path('M1 12.6C22 11.6 58 13.2 99 11.4', delay, 0.4));
  const note = (text, delay, cls = '') => `<span class="ip-note ${cls}" style="--d:${delay}s" aria-hidden="true">${text}</span>`;
  return `
  <section class="intro" id="intro" aria-labelledby="intro-title">
    <div class="intro-head">
      <h1 id="intro-title" class="intro-title">믿기 전에, <span class="intro-em"><span class="fx-t">의심하기</span>${svg('ip-hl ip-title', '0 0 100 20', path('M1 13.2C30 12.2 64 13.8 99 12.4', 0, 0.45))}</span></h1>
      <p class="intro-lead">AI 답변에서 확인할 곳을 먼저 찾고, 직접 고친 기록을 증빙서로 남겨요.</p>
    </div>

    <figure class="intro-sheet" aria-label="연습용 AI 답변을 빨간펜으로 고친 예">
      <figcaption class="intro-cap"><span>연습용 AI 답변</span><button type="button" class="ghost small-btn intro-replay" data-intro="replay" hidden>다시 그리기</button></figcaption>
      <ol class="intro-lines">
        <li style="--d:.3s">Kasneci 외(2023)는 <span class="fx" data-g="1" tabindex="0" aria-label="Nature Education — 학술지 이름이 틀림, Learning and Individual Differences로 고침">${hl(0.5)}<span class="fx-t">Nature Education</span>${svg('ip-pen', '0 0 100 20', path('M-3 12.2C28 10.6 66 10.4 103 8.6', 0.95, 0.25))}${note('Learning and Individual Differences', 1.2)}</span>에 발표한 논문에서 ChatGPT가 글쓰기 피드백을 개인화해 학습을 도울 수 있다고 밝혔습니다.</li>
        <li style="--d:1.55s"><span class="fx" data-g="1" tabindex="0" aria-label="Whitfield와 Okafor(2024) — 찾을 수 없는 연구, 확인 안 됨, 삭제">${hl(1.75)}<span class="fx-t">Whitfield와 Okafor(2024)</span>${svg('ip-pen', '0 0 100 20', path('M1 3C30 7 66 13 99 17.4', 2.2, 0.18) + path('M2 17.6C34 13 70 7.4 98.5 2.6', 2.4, 0.18))}${note('확인 안 됨, 삭제', 2.62)}</span>의 연구는 국내 대학생 312명을 대상으로 AI 사용 집단의 글쓰기 점수가 평균 12% 낮아졌다고 보고했습니다.</li>
        <li style="--d:3.05s">종합하면, AI를 쓰면 글쓰기 실력이 떨어지는 것은 AI가 생각하는 과정을 대신하기 <span class="fx fx-ring" data-g="2" tabindex="0" aria-label="때문입니다 — 근거 없이 원인을 단정함, 근거?"><span class="fx-t">때문입니다</span>${svg('ip-pen ip-ring', '0 0 100 40', path('M84 7C66 1.6 22 2.4 8 13 -2 21 4 33 30 36.6 60 40 92 35 97 23 101 13 88 5.4 62 4.2', 3.25, 0.62))}${note('근거?', 3.9, 'ip-side')}</span>.</li>
      </ol>
    </figure>

    <ol class="intro-checks" aria-label="답변을 볼 때 묻는 세 가지">
      <li data-g="1"><span class="ic-n">1</span><strong>사실과 다른가</strong><span class="ic-s">논문·숫자·인물이 실제와 같은지</span></li>
      <li data-g="2"><span class="ic-n">2</span><strong>치우치거나 비약했나</strong><span class="ic-s">근거 없이 원인을 단정하지 않았는지</span></li>
      <li data-g="3"><span class="ic-n">3</span><strong>지금도 맞는가</strong><span class="ic-s">날짜·제도가 그사이 바뀌지 않았는지</span></li>
    </ol>

    <div class="intro-actions">
      <button type="button" class="primary" data-action="intro-practice">연습용 답변으로 해 보기</button>
      ${hasWork()
    ? `<button type="button" data-action="intro-continue">하던 작업 이어서 하기 · ${state.step}단계</button>`
    : '<button type="button" data-action="intro-paste">내 AI 대화 붙여넣기</button>'}
    </div>
  </section>`;
}
// 화면에 들어오면 한 번 그린다. 줄인 동작이면 처음부터 다 그려진 상태(.anim 을 붙이지 않음).
function playIntro() {
  const root = document.getElementById('intro');
  if (!root) return;
  const replay = root.querySelector('.intro-replay');
  const end = () => { replay.hidden = false; };
  const play = () => {
    root.classList.remove('play');
    void root.offsetWidth; // 다시 그리기: 애니메이션 처음부터
    root.classList.add('play');
    replay.hidden = true;
    clearTimeout(playIntro._t);
    playIntro._t = setTimeout(end, 4700);
  };
  // 고친 곳 ↔ 세 가지 질문 잇기 (Mobbin 참고: 문장 아래 라벨이 연결되는 Giga 'how it works')
  const link = (g) => root.querySelectorAll('[data-g]').forEach((el) => el.classList.toggle('lit', !!g && el.dataset.g === g));
  root.addEventListener('pointerover', (e) => link(e.target.closest('[data-g]')?.dataset.g));
  root.addEventListener('pointerleave', () => link(null));
  root.addEventListener('focusin', (e) => link(e.target.closest('[data-g]')?.dataset.g));
  root.addEventListener('focusout', () => link(null));
  root.addEventListener('click', (e) => { if (e.target.closest('[data-intro="replay"]')) play(); });
  if (reducedMotion()) { end(); return; }
  root.classList.add('anim');
  const sheet = root.querySelector('.intro-sheet');
  if (!('IntersectionObserver' in window)) { play(); return; }
  const io = new IntersectionObserver((ents) => {
    if (ents.some((x) => x.isIntersecting)) { io.disconnect(); play(); }
  }, { threshold: 0.35 });
  io.observe(sheet);
}

/* ---------- 렌더 ---------- */
function render(focus = true) {
  const views = { 1: viewStep1, 2: viewStep2, 3: viewStep3, 4: viewStep4, 5: viewStep5 };
  clearReveal();
  const intro = showIntro();
  document.body.classList.toggle('is-intro', intro);
  $view.innerHTML = intro ? viewIntro() : practiceNote() + views[state.step]();
  if (intro) playIntro();
  document.querySelectorAll('#stepper li').forEach((li) => {
    const n = Number(li.dataset.step);
    li.classList.toggle('current', n === state.step);
    li.classList.toggle('done', n < state.step || (n <= state.maxStep && n !== state.step));
    li.style.cursor = n <= state.maxStep && n !== state.step ? 'pointer' : 'default';
    if (n === state.step) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
  });
  document.getElementById('demo-badge').hidden = !DEMO;
  if (state.step === 3 && state.ai && pendingReveal) { pendingReveal = false; runReveal(); }
  if (state.step === 5) { const a = analysis(); countUp(document.getElementById('ratio5'), a.ratio); }
  if (focus) { $view.focus({ preventScroll: true }); window.scrollTo(0, 0); }
}

function go(step) {
  if (step > state.maxStep) return;
  state.step = step;
  save();
  render();
}

function advance(step) {
  state.step = step;
  state.maxStep = Math.max(state.maxStep, step);
  save();
  render();
}

/* ---------- 동작 ---------- */
async function classify() {
  loading = true;
  lastError = null;
  render(false);
  try {
    // 예시 답변이면 저장된 결과를 쓴다 (API 호출 없음)
    const ex = await findExample(state.answer);
    if (ex) {
      state.ai = { ...ex.result, at: new Date().toISOString() };
      pendingReveal = true;
      return;
    }
    const key = `${state.answer.trim()}|${(state.candidates || []).join(',')}`;
    let r = prefetch?.key === key ? await prefetch.p : null;
    prefetch = null;
    if (!r || !r.ok) {
      const res = await fetch('api/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: classifyBody() });
      r = { ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) };
    }
    const data = r.data;
    if (!r.ok) throw new Error(data.error || `서버 오류 (${r.status})`);
    state.ai = { items: data.items, model: data.model, promptVersion: data.promptVersion, at: data.at };
    pendingReveal = true;
    document.getElementById('engine-info').textContent = `분류 엔진: ${data.model} · 프롬프트 ${data.promptVersion} · 제작: 팀 더블체크 (Claude·Claude Code로 개발)`;
  } catch (e) {
    lastError = e.message === 'Failed to fetch' ? '인터넷 연결 또는 서버 주소를 확인해 주세요.' : e.message;
    loadDemo().catch(() => {});
  } finally {
    loading = false;
    save();
    render(false);
  }
}

const actions = {
  async 'load-demo'(el) {
    try {
      const d = await loadExample(el?.dataset.key || 'demo');
      if (state.answer.trim() && state.answer.trim() !== d.answer.trim() && !confirm('입력한 답변을 예시로 바꿀까요?')) return;
      state.answer = d.answer;
      state.meta = { ...state.meta, ...d.meta };
      state.autoFilled = false;
      save();
      render(false);
      toast('예시 답변을 불러왔습니다.');
    } catch { toast('예시를 불러오지 못했습니다.'); }
  },
  'confirm-paste'() { confirmPaste(); },
  // 5단계: 시연용 예시의 샘플 결론 (발표 시간이 없을 때)
  'sample-conclusion'() {
    const t = cachedExample(state.answer)?.sampleConclusion;
    if (!t) return;
    if (state.conclusion.trim() && state.conclusion !== t && !confirm('지금 쓴 결론을 샘플 결론으로 바꿀까요?')) return;
    state.conclusion = t;
    save();
    const ta = document.querySelector('textarea[data-bind="conclusion"]');
    if (ta) ta.value = t;
    const box = document.getElementById('report-blocks');
    if (box) box.innerHTML = reportBlocksHtml(analysis());
    toast('샘플 결론을 넣었어요. 증빙서 4번에 들어갔어요.');
  },
  'to-doc'() {
    document.getElementById('s5-doc')?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  },
  // 첫 화면 버튼
  async 'intro-practice'() {
    if (hasWork()) {
      if (!confirm('지금 하던 작업을 지우고 연습용 답변으로 새로 시작할까요? (회차 기록은 남아요)')) return;
      state = freshState();
    }
    introOpen = false;
    state.introSeen = true;
    save();
    await actions['load-demo']({ dataset: { key: 'practice' } });
    if (!state.answer.trim()) render(false); // 예시를 못 읽었으면 빈 1단계로
    window.scrollTo(0, 0);
  },
  'intro-continue'() {
    introOpen = false;
    render();
  },
  'intro-paste'() {
    introOpen = false;
    state.introSeen = true;
    save();
    render();
    document.querySelector('.answer-input')?.focus();
  },
  'fill-sample'() {
    if (!applySampleVerify(analysis())) return;
    const y = window.scrollY;
    render(false);
    window.scrollTo(0, y);
    toast('샘플 데이터를 채웠어요. 문제 있음 문장의 칸을 확인해 보세요.');
  },
  'to-2'() {
    if (state.answer.trim() && state.answer.trim() !== state.confirmedFor) confirmPaste(true);
    const text = state.answer.trim();
    if (!text) { toast('AI 답변을 붙여 넣어 주세요.'); return; }
    if (!state.meta.purpose.trim()) { toast('활용 목적 및 범위를 적어 주세요.'); document.querySelector('[data-bind="meta.purpose"]')?.focus(); return; }
    const url = state.meta.shareUrl.trim();
    if (url && !/^https?:\/\//i.test(url)) { toast('대화 공유 URL은 http:// 또는 https://로 시작해야 합니다.'); return; }
    prepareSession();
    if (!state.candidatesPending && !hasCandidates() && state.sentences.length > 80) { toast('확인해 볼 문장을 고르지 못했고 문장이 너무 많습니다. 80문장 이하로 나눠서 넣어 주세요.'); return; }
    advance(2);
  },
  'to-3'() {
    if (!state.ai) {
      // AI 표시를 보기 직전의 선택을 그대로 기록한다(이후 수정 불가).
      state.doubtLog = {
        ids: [...state.selected],
        texts: state.selected.map((id) => state.sentences.find((s) => s.id === id)?.text ?? ''),
        reasons: Object.fromEntries(state.selected.map((id) => [id, reasonsOf(id)])),
        reasonNotes: Object.fromEntries(state.selected.filter((id) => noteOf(id)).map((id) => [id, noteOf(id)])),
        marks: Object.fromEntries(state.selected.map((id) => [id, marksOf(id).map((m) => ({ ...m }))])),
        markTexts: Object.fromEntries(state.selected.map((id) => [id, markTexts(id)])),
        // 형광펜 내용으로 자동 선택된 칩 중 학생이 끄지 않고 남긴 것
        autoReasons: Object.fromEntries(state.selected.map((id) => [id, (state.autoReasons?.[id] || []).filter((k) => reasonsOf(id).includes(k))]).filter(([, v]) => v.length)),
        at: new Date().toISOString(),
      };
    }
    advance(3);
    if (!state.ai) classify();
  },
  retry() { classify(); },
  async 'use-demo-result'() {
    const d = await findExample(state.answer);
    if (!d) return;
    state.ai = { ...d.result, at: new Date().toISOString() };
    pendingReveal = true;
    save();
    render(false);
  },
  replay() { runReveal(); },
  pick4(el) { pick4(Number(el.dataset.id)); },
  'keep-mine'(el) {
    const id = el.dataset.id;
    state.keepMine = { ...(state.keepMine || {}) };
    if (state.keepMine[id]) delete state.keepMine[id]; else state.keepMine[id] = true;
    save();
    const body = document.getElementById('side-detail');
    if (body && body.querySelector('.pred')) {
      const a = analysis();
      body.querySelector('.pred').outerHTML = predictionBlock(Number(id), a.byId.get(Number(id)), a);
      const html = tipBlock(Number(id), a.byId.get(Number(id)));
      const m = body.querySelector('.tip');
      if (m) m.outerHTML = html || '';
      else if (html) body.querySelector('.pred').insertAdjacentHTML('afterend', html);
    }
  },
  'to-5'() {
    const a = analysis();
    for (const id of a.targets) {
      const v = state.verify[id] || {};
      if (v.verdict !== 'problem') continue;
      const empty = requiredFields(v).find((f) => !(v[f] || '').trim());
      if (empty) {
        toast('문제 있음으로 고른 문장의 필수 칸(문제 발견·교차 검증·정정)을 채워 주세요.');
        if (active4 !== id) pick4(id);
        const el = document.querySelector(`[data-verify="${id}"][data-field="${empty}"]`);
        el?.scrollIntoView({ block: 'center' });
        el?.focus({ preventScroll: true });
        return;
      }
    }
    advance(5);
  },
  go(el) { const n = Number(el.dataset.step); if (n > state.maxStep) advance(n); else go(n); },
  async 'copy-sec'(el) {
    const sec = reportSections(analysis()).find((x) => x.key === el.dataset.key);
    if (sec) await copyText(`${sec.title}\n${sec.body}`);
  },
  async 'copy-kw'(el) {
    await copyText(el.dataset.kw, `검색어를 복사했어요: "${el.dataset.kw}" — 아래 '믿을 만한 곳'에서 붙여 넣어 찾아보세요.`);
  },
  async 'copy-next'() {
    const a = analysis();
    saveNextToHistory(a);
    await copyText(nextText(a));
  },
  'next-reset'() {
    state.nextQ = { ...(state.nextQ || {}), text: null };
    save();
    const a = analysis();
    saveNextToHistory(a);
    document.getElementById('next-q').outerHTML = nextQuestionCard(a);
  },
  async 'copy-all'() {
    await copyText(reportSections(analysis()).map((x) => `${x.title}\n${x.body}`).join('\n\n'));
  },
  print() { window.print(); },
  export() {
    const { step, maxStep, ...session } = state;
    const payload = { app: '의심노트', exportedAt: new Date().toISOString(), session, history: store.get(HISTORY_KEY, []) };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `의심노트_시연_${today()}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
  'clear-history'() {
    if (!confirm('이 브라우저의 검증 기록을 모두 지울까요?')) return;
    store.del(HISTORY_KEY);
    render(false);
  },
  new() {
    state = freshState();
    save();
    render();
  },
};

$view.addEventListener('click', (e) => {
  const mk = e.target.closest('#answer-select mark[data-mark]');
  if (mk && window.getSelection().isCollapsed) { removeMark(Number(mk.dataset.id), Number(mk.dataset.mark)); return; }
  const chip = e.target.closest('#answer-select [data-chip]');
  if (chip) { pickReason(chip); return; }
  const cs = e.target.closest('#answer-compare .sent');
  if (cs) { if (!revealing) openCard(cs.dataset.id); return; }
  const pk = e.target.closest('[data-pick]');
  if (pk) { openCard(pk.dataset.pick); return; }
  const vc = e.target.closest('.vcard[data-card]');
  if (vc && !e.target.closest('a, button, input, select, label, summary')) { if (Number(vc.dataset.card) !== active4) pick4(Number(vc.dataset.card)); return; }
  const btn = e.target.closest('[data-action]');
  if (btn && actions[btn.dataset.action]) actions[btn.dataset.action](btn);
});

$view.addEventListener('keydown', (e) => {
  const sent = e.target.closest?.('#answer-select .sent');
  if (sent && e.target === sent && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); toggleSentence(sent); }
  const cs = e.target.closest?.('#answer-compare .sent');
  if (cs && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); if (!revealing) openCard(cs.dataset.id); }
  const vc = e.target.closest?.('.vcard[data-card]');
  if (vc && e.target === vc && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); pick4(Number(vc.dataset.card)); }
});

function selCountText() {
  const n = state.selected.reduce((sum, id) => sum + marksOf(id).length, 0);
  return `형광펜 ${n}곳 · ${state.selected.length}문장 / ${hasCandidates() ? '후보' : '전체'} ${visibleSentences().length}문장`;
}

function setMarks(id, list) {
  if (list.length) state.marks[id] = mergeMarks(list);
  else { delete state.marks[id]; delete state.reasons[id]; delete state.reasonNotes[id]; if (state.autoReasons) delete state.autoReasons[id]; }
  syncSelected();
}

function afterMarkChange(focusSel) {
  rerenderSelect(focusSel);
  const c = document.getElementById('sel-count');
  if (c) c.textContent = selCountText();
  save();
}

// 키보드 대체: 문장 전체에 긋기 / 모두 지우기
function toggleSentence(el) {
  if (state.ai) { toast('AI 표시를 본 뒤에는 바꿀 수 없습니다.'); return; }
  const id = Number(el.dataset.id);
  const s = state.sentences.find((x) => x.id === id);
  const adding = !marksOf(id).length;
  setMarks(id, adding ? [{ start: 0, end: s.text.length }] : []);
  const auto = adding ? autoPickReasons(id, s.text) : [];
  afterMarkChange(`.sent[data-id="${id}"]`);
  toastAuto(auto);
}

function removeMark(id, idx) {
  if (state.ai) return;
  setMarks(id, marksOf(id).filter((_, i) => i !== idx));
  afterMarkChange(`.sent[data-id="${id}"]`);
}

// 문장 시작부터 (node, offset)까지의 글자 수
function offsetIn(sent, node, offset) {
  const r = document.createRange();
  r.setStart(sent, 0);
  r.setEnd(node, offset);
  return r.toString().length;
}

// 드래그한 범위를 문장별 형광펜으로 저장 (여러 문장에 걸치면 문장마다 나눈다)
function applySelection() {
  if (state.ai) return;
  const box = document.getElementById('answer-select');
  const sel = window.getSelection();
  if (!box || !sel || sel.isCollapsed || !sel.rangeCount) return;
  const range = sel.getRangeAt(0);
  if (!box.contains(range.commonAncestorContainer)) return;
  let changed = false;
  const autoAdded = [];
  for (const sent of box.querySelectorAll('.sent')) {
    if (!range.intersectsNode(sent)) continue;
    const id = Number(sent.dataset.id);
    const text = state.sentences.find((x) => x.id === id)?.text || '';
    const start = sent.contains(range.startContainer) ? offsetIn(sent, range.startContainer, range.startOffset) : 0;
    const end = sent.contains(range.endContainer) ? offsetIn(sent, range.endContainer, range.endOffset) : text.length;
    const span = snapToWords(text, start, end); // 단어 중간에서 끊기지 않게 어절 경계로
    if (!span) continue;
    const { start: a, end: b } = span;
    setMarks(id, [...marksOf(id), { start: a, end: b }]);
    autoAdded.push(...autoPickReasons(id, text.slice(a, b)));
    changed = true;
  }
  sel.removeAllRanges();
  if (changed) afterMarkChange(null);
  toastAuto(autoAdded);
}

/* ---------- 형광펜 내용으로 이유 칩 자동 선택 ----------
   그은 글자에 숫자·날짜·인용 표시·회사/기관 이름이 있으면 해당 칩을 켠다(학생이 다시 눌러 끌 수 있음).
   '잘 모르겠음'을 직접 고른 문장은 건드리지 않는다. 자동으로 켠 칩은 state.autoReasons에 따로 남긴다. */
const DATE_RE = /\d{2,4}\s*년|\d{1,2}\s*월|\d{1,2}\s*일(?![가-힣])|법령|법률|[가-힣]*법(?![가-힣])|제도|조례|규정|가이드라인|시행|제정|개정/;
const CITE_RE = /[《〈「『]|논문|학술지|저널|보고서|연구진|연구[는가팀]|연구 결과|et al|doi|\(\d{4}\)/i;
const ORG_RE = /㈜|\(주\)|주식회사|회사|기업|그룹|재단|협회|위원회|대학교|연구소|연구원|정부|부처|기관|센터|뉴스룸|교수|장관|대표|CEO|말했|밝혔|발표/;
// 회사·기관 이름으로 보지 않을 흔한 영문 약어
const ACRONYM_SKIP = new Set(['AI', 'IP', 'OTT', 'GPT', 'PPT', 'URL', 'DOI', 'PDF', 'IT', 'TV', 'SNS', 'OK', 'VS', 'LLM']);
const hasOrgName = (t) => ORG_RE.test(t) || (t.match(/\b[A-Z][A-Z0-9&]{1,}\b/g) || []).some((w) => !ACRONYM_SKIP.has(w) && !/^GPT/.test(w));
function guessReasons(t) {
  const out = [];
  // 숫자·날짜·제도는 한 칩: 날짜·법·제도 표현이나 (인용 연도를 뺀) 숫자·%가 있으면 켠다
  const noCiteYear = t.replace(/\(\d{4}\)/g, '');
  if (DATE_RE.test(noCiteYear) || /\d|%|퍼센트/.test(noCiteYear)) out.push('num');
  if (CITE_RE.test(t)) out.push('cite');
  // 《작품 제목》 안의 영문 대문자는 회사 이름으로 보지 않는다
  if (hasOrgName(t.replace(/[《〈「『][^》〉」』]*[》〉」』]/g, ''))) out.push('who');
  return out;
}
function autoPickReasons(id, text) {
  const cur = reasonsOf(id);
  if (cur.includes('unsure')) return [];
  const add = guessReasons(text).filter((k) => !cur.includes(k));
  if (!add.length) return [];
  state.reasons[id] = [...cur, ...add];
  state.autoReasons = { ...(state.autoReasons || {}), [id]: [...new Set([...(state.autoReasons?.[id] || []), ...add])] };
  return add;
}
function toastAuto(keys) {
  const names = [...new Set(keys)].map((k) => `'${REASONS[k]}'`);
  if (names.length) toast(`형광펜 내용을 보고 ${names.join(', ')} 칩을 골랐어요. 아니면 칩을 다시 눌러 끄세요.`);
}

$view.addEventListener('mouseup', (e) => {
  if (e.target.closest?.('#answer-select') && !e.target.closest('.reason-chips')) setTimeout(applySelection, 0);
});
$view.addEventListener('touchend', (e) => {
  if (e.target.closest?.('#answer-select') && !e.target.closest('.reason-chips')) setTimeout(applySelection, 300);
});

// 머리말 '초기화' (테스트용): 이번 작업만, 또는 회차 기록까지
document.getElementById('reset-menu')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-reset]');
  if (!b) return;
  const all = b.dataset.reset === 'all';
  if (all) store.del(HISTORY_KEY);
  state = freshState();
  introOpen = false;
  save();
  e.currentTarget.open = false;
  render();
  toast(all ? '기록까지 모두 지웠어요. 처음 상태입니다.' : '이번 작업을 지웠어요.');
});
document.addEventListener('click', (e) => {
  const m = document.getElementById('reset-menu');
  if (m?.open && !m.contains(e.target)) m.open = false;
});

function pickReason(chip) {
  if (state.ai) return;
  const id = Number(chip.dataset.id);
  const k = chip.dataset.chip;
  if (state.autoReasons?.[id]?.includes(k)) state.autoReasons[id] = state.autoReasons[id].filter((x) => x !== k);
  let cur = reasonsOf(id);
  if (cur.includes(k)) cur = cur.filter((x) => x !== k);
  else cur = k === 'unsure' ? ['unsure'] : [...cur.filter((x) => x !== 'unsure'), k];
  if (cur.length) state.reasons[id] = cur; else delete state.reasons[id];
  rerenderSelect(`[data-chip="${chip.dataset.chip}"][data-id="${id}"]`);
  save();
}

function rerenderSelect(focusSel) {
  const box = document.getElementById('answer-select');
  if (!box) return;
  const y = window.scrollY;
  box.innerHTML = renderAnswer('select');
  window.scrollTo(0, y);
  if (focusSel) box.querySelector(focusSel)?.focus({ preventScroll: true });
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  while (keys.length > 1) o = o[keys.shift()];
  o[keys[0]] = value;
}

/* ---------- 대화 공유 URL → 사용한 AI 도구 ----------
   공유 페이지의 대화 내용은 읽을 수 없다(ChatGPT는 브라우저가 아닌 요청에 내용 없는 안내 페이지만 줌, 2026-11-19 확인).
   링크 주소로 도구만 채우고, 공유 페이지를 열어 대화를 드래그해 붙여 넣도록 안내한다(붙여넣기는 parseConversation이 나눔). */
const TOOL_FROM_SHARE = { ChatGPT: () => 'ChatGPT', Gemini: () => 'Gemini', Claude: () => 'Claude', Perplexity: () => 'Perplexity', Copilot: () => 'Microsoft Copilot' };
let shareLast = '';
function scheduleShare(value) {
  const chk = checkShareUrl(value);
  if (!chk || chk.url === shareLast) return;
  shareLast = chk.url;
  state.meta.tool = TOOL_FROM_SHARE[chk.tool]();
  save();
  const sel = document.querySelector('[data-bind="meta.tool"]');
  if (sel) sel.value = state.meta.tool;
  const note = document.getElementById('share-note');
  if (note) note.innerHTML = shareNote(state.meta.shareUrl);
  toast(`링크 주소로 사용한 AI 도구를 '${state.meta.tool}'(으)로 채웠어요. 대화 내용은 공유 페이지를 열어 질문부터 답변까지 드래그해 오른쪽에 붙여 넣어 주세요.`);
}
function shareNote(v) {
  const chk = checkShareUrl(v);
  if (!chk) return '';
  return `<a class="small-btn" href="${esc(chk.url)}" target="_blank" rel="noopener noreferrer">공유 페이지 열기 ↗</a> <span class="muted small">열린 페이지에서 대화를 드래그해 오른쪽 칸에 붙여 넣으면 질문·답변이 채워져요.</span>`;
}

/* ---------- [확인]: 붙여 넣은 대화 → 증빙서 정보 + 의심 후보 + 분류 미리 시작 ---------- */
// "나의 말/ChatGPT의 말" 표시가 없을 때: 첫 단락(또는 첫 줄)이 요청·질문처럼 끝나면 질문으로 본다
function guessConversation(text) {
  const t = String(text || '').replace(/\r\n/g, '\n').trim();
  const ASK = /(\?|줘|주세요|알려줘|해줘|정리해|짜줘|써줘|할까|인가요|나요|까요|해요|하세요)[.!\s]*$/;
  const blocks = t.split(/\n\s*\n/);
  if (blocks.length > 1 && blocks[0].length <= 600 && ASK.test(blocks[0].trim())) return { question: blocks[0].trim(), answer: blocks.slice(1).join('\n\n').trim(), tool: null, turns: 1 };
  const lines = t.split('\n');
  if (lines.length > 3 && lines[0].length <= 300 && ASK.test(lines[0].trim())) return { question: lines[0].trim(), answer: lines.slice(1).join('\n').trim(), tool: null, turns: 1 };
  return null;
}
// 활용 목적 추측(질문의 낱말로): 학생이 고쳐 쓰는 출발점
function guessPurpose(q) {
  const t = String(q || '');
  const course = (t.match(/([가-힣A-Za-z]{2,15})\s*(과목|수업|강의)/) || [])[1];
  const kind = /(발표|PPT|피피티|슬라이드)/i.test(t) ? '발표 자료(PPT) 구성을 위한 자료 조사'
    : /(레포트|리포트|보고서|과제)/.test(t) ? '레포트 작성을 위한 선행 자료 조사'
    : /(논문|연구|선행)/.test(t) ? '선행 연구 탐색'
    : '자료 조사';
  return `${course ? `${course} ` : ''}${kind}의 아이디어 단계에서 참고용으로 활용`;
}
// 문장 나누기·초기화·의심 후보 고르기(비동기) — '다음'과 [확인]이 함께 쓴다
let prefetch = null;
function prepareSession() {
  const text = state.answer.trim();
  if (text !== state.sourceAnswer) {
    state.sentences = splitSentences(text);
    state.sourceAnswer = text;
    state.selected = []; state.ai = null; state.verify = {}; state.doubtLog = null;
    state.summary = ''; state.memo = ''; state.conclusion = ''; state.conclusionAuto = ''; state.compared = '';
    state.reasons = {}; state.reasonNotes = {}; state.marks = {}; state.autoReasons = {}; state.sampleApplied = false;
    state.nextQ = null; state.keepMine = {};
    state.sessionId = `s${Date.now().toString(36)}`;
    state.maxStep = 2;
  }
  if (text !== state.candidatesFor && !state.ai) {
    state.candidatesPending = true;
    state.candidatesFor = text;
    setTimeout(() => {
      const ex = cachedExample(state.answer);
      const picked = ex?.candidates || (state.sentences.length > MAX_CANDIDATES ? pickCandidates(state.sentences) : []);
      state.candidates = picked.length ? picked : null;
      state.candidatesPending = false;
      save();
      prefetchClassify();
      if (state.step === 2) render(false);
    }, 0);
  }
}
const classifyBody = () => JSON.stringify({ question: state.meta.question, sentences: visibleSentences().map(({ id, text }) => { const c = hasCandidates() ? contextOf(state.sentences, id) : ''; return { id, text: c ? `[${c}] ${text}` : text }; }) });
// 3단계 분류를 미리 시작(결과는 3단계 전까지 화면에 쓰지 않는다). 예시 답변은 저장된 결과를 쓰므로 건너뜀.
function prefetchClassify() {
  if (cachedExample(state.answer) || !state.sentences.length) return;
  const key = `${state.answer.trim()}|${(state.candidates || []).join(',')}`;
  if (prefetch?.key === key) return;
  const p = fetch('api/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: classifyBody() })
    .then(async (res) => ({ ok: res.ok, status: res.status, data: await res.json().catch(() => ({})) }))
    .catch(() => null);
  prefetch = { key, p };
}
function confirmPaste(quiet = false) {
  const raw = state.answer.trim();
  if (!raw) { toast('AI에게 한 질문과 답변을 붙여 넣어 주세요.'); return false; }
  const conv = parseConversation(raw) || guessConversation(raw);
  if (conv) {
    state.answer = conv.answer.slice(0, 20000);
    if (conv.question) state.meta.question = conv.question.slice(0, 500);
    if (conv.tool) state.meta.tool = conv.tool;
    if (conv.share && !state.meta.shareUrl) state.meta.shareUrl = conv.share;
  }
  // 사용 날짜: 예시면 예시에 적힌 날짜, 학생이 '사용 날짜' 칸을 고쳤으면 그 값, 아니면 오늘
  const exMeta = cachedExample(state.answer)?.meta;
  if (exMeta?.date) state.meta.date = exMeta.date;
  else if (!state.meta.date || !state.dateManual) state.meta.date = today();
  if (!state.meta.purpose.trim() || state.purposeAuto) { state.meta.purpose = guessPurpose(state.meta.question); state.purposeAuto = true; }
  state.autoFilled = true;
  state.confirmedFor = state.answer.trim();
  prepareSession();
  save();
  if (!quiet) {
    render(false);
    toast(`확인했어요. ${conv?.question ? '질문·' : ''}${conv?.tool ? '도구·' : ''}날짜·활용 목적을 채웠어요. 의심해 볼 문장 ${MAX_CANDIDATES}개를 고르고 있어요.${conv?.question ? '' : ' (질문을 못 찾았어요. 원래 질문 칸을 확인해 주세요)'}`);
  }
  return true;
}

function applyConversation(conv) {
  state.answer = conv.answer.slice(0, 20000);
  if (conv.question) state.meta.question = conv.question.slice(0, 500);
  if (conv.tool) state.meta.tool = conv.tool;
  if (conv.share && !state.meta.shareUrl) state.meta.shareUrl = conv.share;
  if (!state.meta.date) state.meta.date = today();
  state.autoFilled = true;
  save();
  render(false);
  const parts = [conv.question ? '원래 질문' : '', conv.tool ? `도구(${conv.tool})` : '', 'AI 답변'].filter(Boolean).join('·');
  toast(`붙여 넣은 대화에서 ${parts}을 나눠 채웠어요.${conv.turns > 1 ? ` 질문이 ${conv.turns}개라 첫 질문을 넣었어요.` : ''} 활용 목적은 직접 적어 주세요.`);
}
$view.addEventListener('paste', (e) => {
  const ta = e.target.closest?.('textarea[data-bind="answer"]');
  if (!ta) return;
  // 붙여 넣는 순간에는 바꾸지 않는다. [확인]을 누르면 질문·답변을 나눈다.
  return;
});

$view.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.nextqText !== undefined) {
    const a = analysis();
    const had = state.nextQ?.text != null;
    state.nextQ = { checked: nextChecked(a), text: el.value };
    save();
    saveNextToHistory(a);
    if (!had) {
      const bar = el.closest('.next-q').querySelector('.actions');
      bar.insertAdjacentHTML('afterbegin', '<button class="ghost" data-action="next-reset">조건대로 다시 만들기</button>');
    }
    return;
  }
  if (el.dataset.reasonNote) {
    if (state.ai) return;
    const v = el.value;
    if (v.trim()) state.reasonNotes[el.dataset.reasonNote] = v; else delete state.reasonNotes[el.dataset.reasonNote];
    save();
    return;
  }
  if (el.dataset.bind) {
    setPath(state, el.dataset.bind, el.value);
    if (el.dataset.bind === 'meta.shareUrl') scheduleShare(el.value);
    if (el.dataset.bind === 'meta.purpose') state.purposeAuto = false;
    if (el.dataset.bind === 'meta.date') state.dateManual = true;
    if (el.dataset.bind === 'answer') state.dateManual = false; // 새 답변이면 [확인] 때 다시 오늘로
    if (el.dataset.bind === 'answer') document.getElementById('answer-count').textContent = `${el.value.length.toLocaleString()} / 20,000자`;
    if (el.dataset.bind === 'summary') document.getElementById('summary-count').textContent = `${el.value.length} / 150자`;
    if (el.dataset.bind === 'summary' || el.dataset.bind === 'conclusion') {
      const box = document.getElementById('report-blocks');
      if (box) box.innerHTML = reportBlocksHtml(analysis());
    }
    save();
  } else if (el.dataset.verify && el.type !== 'radio' && el.tagName !== 'SELECT') {
    const id = el.dataset.verify;
    state.verify[id] = { ...(state.verify[id] || {}), [el.dataset.field]: el.value };
    if (el.dataset.field === 'cross') {
      const h = document.getElementById(`cross-hint-${id}`);
      if (h) h.innerHTML = crossHint(el.value);
    }
    if (el.dataset.field === 'problem' || el.dataset.field === 'fix') {
      const q = document.getElementById(`quote-${id}`);
      if (q) q.innerHTML = markedQuote(state.sentences.find((s) => s.id === Number(id))?.text || '', state.verify[id]);
    }
    updateVerifyProgress();
    save();
  }
});

$view.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.nextq) {
    const a = analysis();
    state.nextQ = { checked: { ...nextChecked(a), [el.dataset.nextq]: el.checked }, text: state.nextQ?.text ?? null };
    save();
    saveNextToHistory(a);
    if (state.nextQ.text == null) document.getElementById('next-text').value = composeNext(a);
    else toast('직접 고친 질문은 그대로 두었어요. "조건대로 다시 만들기"로 바꿀 수 있어요.');
    return;
  }
  if (el.dataset.bind === 'meta.tool') { state.meta.tool = el.value; save(); render(false); return; }
  if (el.dataset.verify && (el.type === 'radio' || el.tagName === 'SELECT')) {
    const id = el.dataset.verify;
    state.verify[id] = { ...(state.verify[id] || {}), [el.dataset.field]: el.value };
    save();
    if (el.type === 'radio') {
      const y = window.scrollY;
      render(false);
      window.scrollTo(0, y);
      document.querySelector(`input[name="${el.name}"][value="${el.value}"]`)?.focus({ preventScroll: true });
    }
  }
});

function pick4(id) {
  active4 = id;
  const y = window.scrollY;
  render(false);
  window.scrollTo(0, y);
  const card = document.querySelector(`.vcard[data-card="${id}"]`);
  const r = card?.getBoundingClientRect();
  if (r && (r.top < 0 || r.top > window.innerHeight - 80)) card.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
  if (window.innerWidth < 1200) document.getElementById('verify-side')?.scrollIntoView({ block: 'nearest' });
}

function updateVerifyProgress() {
  const a = analysis();
  const vs = verifyStats(a);
  const bar = document.getElementById('verify-progress');
  if (bar) bar.style.width = `${pct(vs.seen, vs.total)}%`;
  const lbl = document.getElementById('verify-progress-label');
  if (lbl) lbl.textContent = progressLabel(vs);
}

async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = document.createElement('textarea');
    t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
  toast(msg || '복사했습니다. 증빙서에 붙여 넣으세요.');
}

document.querySelector('.logo')?.addEventListener('click', (e) => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return; // 새 탭 열기는 그대로
  e.preventDefault();
  if (loading) return;
  introOpen = true;
  render();
});

document.getElementById('stepper').addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const n = Number(li.dataset.step);
  if (n <= state.maxStep && n !== state.step && !loading) go(n);
});

/* 새로고침 중 로딩 상태였다면 다시 2단계로 */
if (state.step === 3 && !state.ai) state.step = 2;
/* 6단계(증빙서 저장)는 없앴다 — 그때 저장된 상태는 5단계로 */
if (state.step > 5) state.step = 5;
if (state.maxStep > 5) state.maxStep = 5;
/* 후보를 고르는 도중에 새로고침했다면 여기서 마저 고른다(스켈레톤에 멈추지 않게) */
if (state.candidatesPending) {
  const picked = state.sentences?.length > MAX_CANDIDATES ? pickCandidates(state.sentences) : [];
  state.candidates = picked.length ? picked : null;
  state.candidatesPending = false;
}
if (DEMO) loadDemo().catch(() => {});
// 새로고침 뒤에도 예시 표시(연습용 알림·샘플 버튼)가 보이게 예시를 미리 읽어 둔다
Promise.all(EXAMPLES.map((ex) => loadExample(ex.key).catch(() => null))).then(() => { if (cachedExample(state.answer)) render(false); });
render(false);
