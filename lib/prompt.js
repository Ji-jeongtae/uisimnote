// 의심노트 분류 프롬프트 + Gemini 호출 (서버 전용)
// 프롬프트를 고치면 PROMPT_VERSION을 올리고 prompt-log/에 입력·출력·문제·수정을 기록한다.

import { SITES, SITE_KEYS, cleanOfficial } from './sites.js';

export const PROMPT_VERSION = 'v3 (2026-11-19)';
const SITE_LIST = SITE_KEYS.map((k) => `${k}(${SITES[k].name}: ${SITES[k].desc})`).join(', ');

// 유형 → 단계. 서버가 이 표로 단계를 다시 계산해 모델의 단계 표기 실수를 막는다.
export const TYPE_LEVEL = {
  '통계·수치': 'must', '논문·책 인용': 'must', '인물·기관 발언': 'must', '날짜·법령': 'must',
  '인과관계': 'should', '일반화': 'should', '최신 동향': 'should',
  '개념 정의': 'info', '일반 상식': 'info', '의견·요약': 'info',
};
export const TYPES = Object.keys(TYPE_LEVEL);
const RANK = { must: 3, should: 2, info: 1 };

// [유형] 블록만 버전마다 다르다. v4는 유형마다 'AI가 틀리기 쉬운 방식'을 한 줄씩 붙였다(2단계 힌트 카드의 'AI는 이렇게 틀려요'와 같은 내용).
// 이 줄은 분류를 돕기 위한 설명이다. 그 문장이 실제로 틀렸는지는 판단하지 않는다(절대 규칙 1·2 그대로).
const TYPES_V3 = `[유형] types에는 아래 이름만 쓴다. 한 문장에 유형이 여러 개면 해당하는 것을 모두 넣고, 가장 중요한 것을 맨 앞에 둔다.
- 확인 필수(must): 통계·수치 / 논문·책 인용 / 인물·기관 발언 / 날짜·법령
- 확인 권장(should): 인과관계 / 일반화('대부분·항상·모두·반드시') / 최신 동향
- 참고(info): 개념 정의 / 일반 상식 / 의견·요약 (제목·인사·연결 문장 포함)
level은 types 중 가장 높은 단계다.`;
const TYPES_V4 = `[유형] types에는 아래 이름만 쓴다. 한 문장에 유형이 여러 개면 해당하는 것을 모두 넣고, 가장 중요한 것을 맨 앞에 둔다.
각 유형 옆의 'AI가 틀리기 쉬운 방식'은 왜 그 유형을 확인해야 하는지에 대한 설명이다. 입력 문장이 실제로 그렇게 틀렸는지는 판단하지 말고, 유형을 고르는 데만 쓴다.
- 확인 필수(must)
  · 통계·수치: %, ○명, ○억 원 같은 수치. AI가 틀리기 쉬운 방식: 그럴듯한 숫자를 만들어 내거나 다른 조사의 숫자를 옮겨 적는다.
  · 날짜·법령: 사건·제도·법령의 시점이나 이름. AI가 틀리기 쉬운 방식: 바뀌기 전의 날짜·제도를 지금 것처럼 말한다.
  · 논문·책 인용: "○○의 연구에 따르면", 저자(연도), 《책 제목》, 학술지·보고서. AI가 틀리기 쉬운 방식: 없는 논문을 지어내거나 있는 논문의 저자·학술지·연도를 틀린다.
  · 인물·기관 발언: "~가 밝혔다", "~에 따르면", 회사·기관이 발표·소개했다는 내용. AI가 틀리기 쉬운 방식: 말한 사람이나 기관을 바꿔 적는다.
- 확인 권장(should)
  · 인과관계: "~때문에", "~덕분에". AI가 틀리기 쉬운 방식: 원인 하나로 단정한다.
  · 일반화: "대부분·항상·모두·반드시". AI가 틀리기 쉬운 방식: 근거 없이 넓게 말한다.
  · 최신 동향: "최근", "요즘", 현재 상황. AI가 틀리기 쉬운 방식: 지난 정보를 지금 것처럼 말한다.
- 참고(info): 개념 정의 / 일반 상식 / 의견·요약 (제목·인사·연결 문장, 학생에게 하는 조언 포함)
level은 types 중 가장 높은 단계다.`;

const buildPrompt = (typesBlock) => `너는 웹 서비스 '의심노트'의 주장 분류기다.
학생이 AI 자료조사 답변을 스스로 검증하도록, 각 문장이 어떤 종류의 주장인지와 어디서 확인하면 되는지만 알려 준다.

[절대 규칙]
1. 참·거짓, 정확성, 신뢰도를 판정하지 않는다. "사실이다", "틀렸다", "정확하다", "존재하지 않는다", "잘못되었다", "의심스럽다" 같은 판단을 쓰지 않는다. 너도 틀릴 수 있고, 판정은 학생이 출처로 내린다.
2. 올바른 수치·정답·정정 내용을 알려 주지 않는다.
3. 출처 URL, 논문 제목, 저자 등을 새로 만들어 내지 않는다. 검색 키워드만 제안한다.
4. 입력의 모든 문장에 대해 id마다 정확히 하나의 결과를 낸다. 문장을 합치거나 빼지 않는다.

${typesBlock}

[인용 우선 규칙] 논문·연구·보고서·책·학술지를 언급하는 문장은 연도나 날짜가 들어 있어도 '논문·책 인용'을 types 맨 앞에 둔다. 연도는 그 문헌을 가리키는 정보이지 '날짜·법령'이 아니다.
'날짜·법령'은 사건·제도·법령의 시점 자체가 주장일 때만 쓴다(예: "○○법은 2024년 시행되었다").

[검색어 규칙] keywords는 2~3개.
- 저자·기관·주제 중심으로 만든다. 문헌이면 저자 이름 + 발행 연도 + 주제어로 그 문헌을 찾을 수 있게 한다. 외국 문헌이면 영어 검색어를 하나 넣는다.
- 학생이 검증해야 할 속성(학술지명, 수치·비율, 사건 날짜)은 검색어에 넣지 않는다. 그 값을 넣으면 AI가 말한 내용을 그대로 확인하는 검색이 된다.
- 문장 앞부분을 그대로 잘라 쓰지 않는다.
- info는 빈 배열이어도 된다.

[예시]
입력: "2021년 한국교육개발원 보고서에 따르면 대학생의 62%가 과제에 생성형 AI를 쓴다."
출력: {"types":["논문·책 인용","통계·수치"],"level":"must","reason":"보고서 원문에서 조사 대상과 비율을 직접 확인해야 합니다.","media":["official","statistics"],"keywords":["한국교육개발원 대학생 생성형 AI 활용 조사","대학생 생성형 AI 과제 활용 실태"],"sites":["kosis","riss"],"official":[{"name":"한국교육개발원","domain":"kedi.re.kr"}]}
(62%는 검증할 값이므로 검색어에 넣지 않는다.)

입력: "Smith와 Lee(2020)의 연구는 수면 시간이 줄면 성적이 떨어진다고 밝혔다."
출력: {"types":["논문·책 인용","인과관계"],"level":"must","reason":"연구가 실제로 이런 인과를 밝혔는지 원문에서 확인해야 합니다.","media":["academic"],"keywords":["Smith Lee 2020 sleep academic performance","수면 시간 학업 성취 연구"],"sites":["scholar","riss"],"official":[]}

나쁜 검색어 예: "2023년 Nature에 실린" (문장 앞부분을 자름, 학술지명 포함) → 쓰지 않는다.

[필드]
- reason: 학생이 무엇을 확인해야 하는지 한 문장(40자 안팎). 판정 없이 확인 대상만 말한다.
- media: academic(학술 DB), statistics(공공 통계), official(원문 기관 자료) 중 0~2개.
- sites: 이 문장을 원문으로 확인하기 좋은 곳을 아래 목록의 key로만 0~3개 고른다. 목록에 없는 key나 URL은 쓰지 않는다. info는 빈 배열이어도 된다.
  목록: ${SITE_LIST}
  예: 기업 실적 → dart / 영화 관객 수 → kobis / 법 시행일 → law / 정부 발표 → korea / 국내 논문 → riss, kci / 해외 논문 → scholar / 통계 → kosis
- official: 문장에 나오는 회사·기관·단체의 공식 웹사이트를 0~2개 {name, domain}으로 낸다. domain은 경로 없이 도메인만 쓴다(예: {"name":"CJ ENM","domain":"cjenm.com"}). 공식 도메인을 확실히 알 때만 쓰고, 모르면 빈 배열로 둔다. 기사·블로그·위키 주소는 쓰지 않는다.`;

// 버전별 프롬프트(실험 비교용). 앱·서버는 SYSTEM_PROMPT를 쓴다 — v3 (v4는 일관성 하락으로 보관만, CHANGELOG 참고).
export const PROMPTS = { v3: buildPrompt(TYPES_V3), v4: buildPrompt(TYPES_V4) };
export const SYSTEM_PROMPT = PROMPTS.v3;

export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'INTEGER' },
          types: { type: 'ARRAY', items: { type: 'STRING', enum: TYPES } },
          level: { type: 'STRING', enum: ['must', 'should', 'info'] },
          reason: { type: 'STRING' },
          media: { type: 'ARRAY', items: { type: 'STRING', enum: ['academic', 'statistics', 'official'] } },
          keywords: { type: 'ARRAY', items: { type: 'STRING' } },
          sites: { type: 'ARRAY', items: { type: 'STRING', enum: SITE_KEYS } },
          official: {
            type: 'ARRAY',
            items: { type: 'OBJECT', properties: { name: { type: 'STRING' }, domain: { type: 'STRING' } }, required: ['name', 'domain'] },
          },
        },
        required: ['id', 'types', 'level', 'reason', 'media', 'keywords', 'sites', 'official'],
      },
    },
  },
  required: ['items'],
};

export const LIMITS = { maxSentences: 80, maxChars: 8000, maxQuestion: 500 };

export function validateInput(body) {
  if (!body || !Array.isArray(body.sentences)) return '문장 목록이 없습니다.';
  const s = body.sentences;
  if (s.length === 0) return '문장이 비어 있습니다.';
  if (s.length > LIMITS.maxSentences) return `문장은 ${LIMITS.maxSentences}개까지 분석할 수 있습니다.`;
  let total = 0;
  for (const x of s) {
    if (!Number.isInteger(x?.id) || typeof x?.text !== 'string') return '문장 형식이 올바르지 않습니다.';
    total += x.text.length;
  }
  if (total > LIMITS.maxChars) return `답변은 ${LIMITS.maxChars}자까지 분석할 수 있습니다.`;
  if (body.question && String(body.question).length > LIMITS.maxQuestion) return '질문이 너무 깁니다.';
  return null;
}

// 모델 출력이 문장 목록과 어긋나도 화면이 깨지지 않게 맞춘다.
function cleanKeywords(list, sentence) {
  const head = sentence.replace(/\s+/g, ' ').trim();
  return (Array.isArray(list) ? list : [])
    .map((k) => String(k).replace(/\s+/g, ' ').trim().slice(0, 60))
    .filter((k) => k && !(k.length >= 8 && head.startsWith(k))) // 문장 앞부분 자르기 차단
    .slice(0, 3);
}

export function normalize(items, sentences) {
  const byId = new Map();
  const textOf = new Map(sentences.map((s) => [s.id, s.text]));
  for (const it of Array.isArray(items) ? items : []) {
    if (!Number.isInteger(it?.id) || byId.has(it.id) || !textOf.has(it.id)) continue;
    const raw = Array.isArray(it.types) ? it.types : (it.type ? [it.type] : []);
    const types = [...new Set(raw.filter((t) => TYPES.includes(t)))];
    let level = ['must', 'should', 'info'].includes(it.level) ? it.level : 'info';
    if (types.length) level = types.reduce((a, t) => (RANK[TYPE_LEVEL[t]] > RANK[a] ? TYPE_LEVEL[t] : a), 'info');
    byId.set(it.id, {
      id: it.id,
      level,
      types,
      reason: String(it.reason || '').slice(0, 200),
      media: (Array.isArray(it.media) ? it.media : []).filter((m) => ['academic', 'statistics', 'official'].includes(m)).slice(0, 3),
      keywords: cleanKeywords(it.keywords, textOf.get(it.id)),
      sites: [...new Set((Array.isArray(it.sites) ? it.sites : []).filter((k) => SITE_KEYS.includes(k)))].slice(0, 3),
      official: cleanOfficial(it.official),
    });
  }
  let missing = 0;
  const out = sentences.map((s) => {
    if (byId.has(s.id)) return byId.get(s.id);
    missing++;
    return { id: s.id, level: 'info', types: [], reason: '분류 결과를 받지 못한 문장입니다. 직접 판단해 주세요.', media: [], keywords: [], sites: [], official: [] };
  });
  return { items: out, missing };
}

export async function classifyWithGemini({ question, sentences }, { apiKey, model, fetchImpl = fetch, systemPrompt = SYSTEM_PROMPT }) {
  const userPayload = {
    question: question || '(입력 없음)',
    sentences: sentences.map((s) => ({ id: s.id, text: s.text })),
  };
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: '다음은 학생이 받은 AI 답변을 문장 단위로 나눈 것이다. 규칙에 따라 분류하라.\n' + JSON.stringify(userPayload) }] }],
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('Gemini 응답을 읽지 못했습니다.');
      }
      return { ...normalize(parsed.items, sentences), raw: text };
    }
    const errText = await res.text().catch(() => '');
    lastErr = new Error(`Gemini 오류 ${res.status}: ${errText.slice(0, 300)}`);
    lastErr.status = res.status;
    if (res.status < 500 && res.status !== 429) break; // 재시도해도 소용없는 오류
    await new Promise((r) => setTimeout(r, 1200));
  }
  throw lastErr;
}
