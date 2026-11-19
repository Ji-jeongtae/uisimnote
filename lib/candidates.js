// 2단계 '먼저 의심하기' 후보 고르기 (브라우저·Node 공용, API 호출 없음)
// AI 답변 전문에서 확인해 볼 만한 사실 주장 문장을 규칙으로 점수 매겨 MAX개만 고른다.
// - 점수: 숫자·연도·금액·인원, 인용(교재·논문·보고서·공시), 회사·기관 이름, 단정 표현
// - 감점: 학생에게 하는 조언·권유 문장(“~하는 게 좋아”, “~해 봐”), 제목·짧은 줄, 출처 줄, 질문
// - 같은 내용 반복(발표 대본 등)은 비슷한 문장 중 하나만 남긴다.
// 고른 문장의 참·거짓이나 유형은 판단하지 않는다(그건 3단계 Gemini 분류와 학생 몫).

export const MAX_CANDIDATES = 5;

const ADVICE = /(좋아|좋겠|좋을 것|해 ?줘|해 ?봐|하면 돼|하면 좋|하자|추천|기억해|강조할|넣어|정리해|구성하|만들|연결하면|살펴보겠|발표하겠|마치겠|감사합니다|생각해 ?보)/;
const ORG = /(CJ|tvN|스튜디오드래곤|티빙|넷플릭스|아카데미|드림웍스|DreamWorks|정부|협회|위원회|대학교|연구소|재단|공사|㈜|\(주\)|회사|기업|그룹)/;
const ACRONYM_SKIP = new Set(['AI', 'IP', 'OTT', 'GPT', 'PPT', 'URL', 'PD', 'TV', 'IT', 'SNS', 'CG']);
const hasOrg = (t) => ORG.test(t) || (t.match(/\b[A-Z][A-Z0-9&]{1,}\b/g) || []).some((w) => !ACRONYM_SKIP.has(w));
const CITE = /(교재|논문|학술지|보고서|공시|사업보고서|발표했|밝혔|에 따르면|뉴스룸)/;
const NUM = /\d/;
const QTY = /(\d[\d,.]*\s*(%|퍼센트|억|만|조|원|명|건|배|위|편|개국|주년))/;
const EVENT = /(수상|선정|설립|분할|인수|합병|출시|상장|개최|제정|시행|체결)/;
const YEAR = /(19|20)\d{2}\s*년|\((19|20)\d{2}\)/;
const ABSOLUTE = /(최초|최대|최고|가장|유일|대부분|항상|모두|반드시|처음으로)/;
const CAUSE = /(때문|덕분|으로 인해|로 인해|결과로|그 결과)/;

export function scoreSentence(text) {
  const t = String(text || '').trim();
  if (t.length < 18 || t.length > 240) return -99;
  if (/^(자료 출처|출처|참고)/.test(t) || /\]\(https?:\/\//.test(t) || /^\[[^\]]+\]\(/.test(t)) return -99; // 출처·링크 줄
  if (/https?:\/\//.test(t) && t.replace(/https?:\/\/\S+/g, '').trim().length < 20) return -99;
  if (/확인\.?$/.test(t)) return -99; // 참고문헌 설명("… 확인.")
  if (!/[.!。…다요어해함음됨]$/.test(t.replace(/[)\]」』"'”’\s]+$/, ''))) return -99; // 제목·표 칸처럼 문장으로 끝나지 않는 줄
  if (/\?$/.test(t)) return -99;
  let s = 0;
  if (QTY.test(t)) s += 4; else if (NUM.test(t.replace(YEAR, ''))) s += 2;
  if (YEAR.test(t)) s += 2;
  if (CITE.test(t)) s += 2;
  if (hasOrg(t)) s += 2;
  if (EVENT.test(t)) s += 1;
  if (/[《「『]/.test(t)) s += 1;
  if (ABSOLUTE.test(t)) s += 1;
  if (CAUSE.test(t)) s += 1;
  if (ADVICE.test(t)) s -= 4;
  return s;
}

// 비슷한 문장 판별: 글자 2개씩 묶은 조각의 겹침 비율
function bigrams(t) {
  const x = t.replace(/[\s.,·《》()"'“”‘’]/g, '');
  const set = new Set();
  for (let i = 0; i < x.length - 1; i++) set.add(x.slice(i, i + 2));
  return set;
}
function similar(a, b) {
  const A = bigrams(a), B = bigrams(b);
  let inter = 0;
  for (const g of A) if (B.has(g)) inter++;
  return inter / Math.min(A.size, B.size || 1);
}

export function pickCandidates(sentences, max = MAX_CANDIDATES) {
  // 점수 4 이상을 먼저, 모자라면 1 이상으로 채운다(사실 주장이 적은 답변)
  const ranked = sentences
    .map((s) => ({ s, score: scoreSentence(s.text) }))
    .filter((x) => x.score >= 1)
    .sort((a, b) => (b.score >= 4) - (a.score >= 4) || b.score - a.score || a.s.id - b.s.id);
  const chosen = [];
  for (const x of ranked) {
    if (chosen.some((c) => similar(c.s.text, x.s.text) > 0.5)) continue;
    chosen.push(x);
    if (chosen.length >= max) break;
  }
  return chosen.map((x) => x.s.id).sort((a, b) => a - b);
}

// 후보 문장 바로 앞의 짧은 제목 줄(예: "《눈물의 여왕》(2024)")을 맥락으로 보여 준다
export function contextOf(sentences, id) {
  const i = sentences.findIndex((s) => s.id === id);
  const near = [];
  for (let k = i - 1; k >= Math.max(0, i - 4); k--) {
    const t = sentences[k].text.trim();
    if (t.length <= 40 && scoreSentence(t) === -99 && !/^(자료 출처|출처)/.test(t)) near.push(t);
  }
  // 작품·문서 제목(《》)이 있는 줄을 먼저, 없으면 가장 가까운 짧은 줄
  const pick = near.find((t) => /[《「『]/.test(t)) || near[0] || '';
  return pick.replace(/^\s*(\d{1,2}[.)]|[-•·])\s*/, ''); // 원문 목록 번호는 떼어 낸다(후보 번호와 헷갈리지 않게)
}
