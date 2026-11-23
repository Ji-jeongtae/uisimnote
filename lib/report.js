// 증빙서 문장 조립 (브라우저·Node 공용)
// 원칙: 모든 문장은 '학생 입력 + 고정 문장 틀'로만 만든다. AI가 생성한 문장은 들어가지 않는다.

const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
export const circled = (n) => (n >= 1 && n <= 20 ? CIRCLED[n - 1] : `(${n})`);

// 받침에 맞는 조사. 한글로 끝나지 않으면 '을(를)'처럼 둘 다 적는다.
// 영문 글자·숫자로 끝나면 읽는 소리의 받침으로 고른다(예: M=엠 → 받침 ㅁ, 2=이 → 받침 없음, L=엘 → ㄹ)
const LATIN_JONG = { L: 8, M: 16, N: 4, R: 8 }; // 받침 있는 글자(ㄹ=8, ㅁ=16, ㄴ=4)
const DIGIT_JONG = { 0: 21, 1: 8, 3: 16, 6: 1, 7: 8, 8: 8 }; // 영(ㅇ), 일·칠·팔(ㄹ), 삼(ㅁ), 육(ㄱ)
export function josa(word, pair) {
  const [withJong, withoutJong] = pair.split('/');
  // 끝의 괄호 설명은 빼고 그 앞 말에 붙인다: "CJ E&M(2018년 …)" → "CJ E&M"
  let w = String(word || '').trim().replace(/\s*\([^()]*\)$/, '').replace(/[\s"'”’)\]」』.,…]+$/, '');
  const last = w.slice(-1);
  const ch = w.charCodeAt(w.length - 1);
  let jong;
  if (ch >= 0xac00 && ch <= 0xd7a3) jong = (ch - 0xac00) % 28;
  else if (/[A-Za-z]/.test(last)) jong = LATIN_JONG[last.toUpperCase()] || 0;
  else if (/\d/.test(last)) jong = DIGIT_JONG[last] || 0;
  else return pair === '으로/로' ? '(으)로' : `${withJong}(${withoutJong})`;
  if (pair === '으로/로') return jong === 0 || jong === 8 ? '로' : '으로'; // ㄹ 받침은 '로'
  return jong ? withJong : withoutJong;
}

// 4단계 '문제 있음'의 정정 방식: 고침 / 삭제 / 표현 완화
export const FIX_MODES = ['fix', 'delete', 'soften'];
export const FIX_MODE_LABEL = { fix: '고침', delete: '삭제', soften: '표현 완화' };
const modeOf = (x) => (FIX_MODES.includes(x?.fixMode) ? x.fixMode : 'fix');

const need = (x, label) => String(x || '').trim() || `(${label} 작성 필요)`;

// 교차 검증 칸에서 첫 링크(URL 또는 DOI)를 찾는다. DOI는 https://doi.org/… 로 바꾼다.
const URL_IN = /https?:\/\/[^\s<>"'()\[\]]+[^\s<>"'()\[\].,;:!?。]/;
const DOI_IN = /\b(?:doi:\s*)?(10\.\d{4,9}\/[^\s<>"'()\[\]]+[^\s<>"'()\[\].,;:!?])/i;
export function linkOf(text) {
  const t = String(text || '');
  const u = t.match(URL_IN);
  if (u) return u[0];
  const d = t.match(DOI_IN);
  return d ? `https://doi.org/${d[1]}` : '';
}
// 링크를 뺀 자료 이름 (예: "Walters & Wilder(2023) https://…" → "Walters & Wilder(2023)")
const labelOf = (text) => String(text || '').replace(URL_IN, '').replace(DOI_IN, '').replace(/\s*[\/|,·-]\s*$/, '').replace(/\s{2,}/g, ' ').trim();
// 인용 발췌: 30자 안에서 띄어쓰기 단위로 자른다(단어 중간에서 끊지 않음). 첫 단어부터 30자를 넘으면 그때만 글자로 자른다.
export function head30(text, max = 30) {
  const t = String(text || '').trim();
  if (t.length <= max) return t;
  let out = '';
  for (const w of t.split(/\s+/)) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > max) break;
    out = next;
  }
  return `${(out || t.slice(0, max)).replace(/[\s,.·:;]+$/, '')}…`;
}

/**
 * @param d {
 *   meta: { tool, toolVersion, date, purpose, question, shareUrl },
 *   answer, conclusion, compared,   // answer = AI 답변 원문
 *   items: [{ no, text, verdict: 'ok'|'problem'|'unused'|undefined, problem, cross, fix, location }],  // 확인이 필요한 주장(대상) 순서대로, no = 원문 몇 번째 문장
 *   ratio
 * }
 */
export function buildReport(d) {
  const m = d.meta;
  const ver = String(m.toolVersion || '').trim();
  const date = String(m.date || '').replace(/-/g, '.');

  const conv = [`[학생질문1] ${need(m.question, '원래 질문')}`, `[AI답변1] ${need(d.answer, 'AI 답변')}`];
  if (String(m.shareUrl || '').trim()) conv.push(`(대화 공유 URL: ${m.shareUrl.trim()})`);

  const N = d.items.length;
  const count = (k) => d.items.filter((x) => x.verdict === k).length;
  const ok = count('ok'), problem = count('problem'), unused = count('unused');
  const unseen = N - ok - problem - unused;
  const problems = d.items.filter((x) => x.verdict === 'problem');

  const lines = [
    `[검증 개요] 확인이 필요한 주장 ${N}개 중 확인함 ${ok} · 문제 발견 ${problem} · 사용 안 함 ${unused}${unseen ? ` · 미확인 ${unseen}` : ''}, AI 표시 전 먼저 의심한 비율 ${d.ratio}%`,
  ];
  if (problems.length) {
    lines.push('[AI 답변의 문제점 발견]');
    problems.forEach((x, i) => {
      // 정정 방식에 맞춘 문제 표현: 고침 = 실제와 다름 / 삭제 = 출처 확인 불가 / 표현 완화 = 근거 없는 단정
      const what = { fix: '이 실제와 다르게 답변됨', delete: '의 출처를 확인할 수 없음', soften: '이 근거 없이 단정됨' }[modeOf(x)];
      lines.push(`${circled(i + 1)} AI 답변 중 "${head30(x.text)}"에서 ${need(x.problem, '문제 발견')} 부분${what}`);
    });
    lines.push('[학생 주도적 수정 내용]');
    // 문제마다 원문 문장 번호와 대조 자료 링크를 반드시 함께 적는다. 링크가 없으면 '작성 필요'로 드러낸다.
    problems.forEach((x, i) => {
      const link = linkOf(x.cross);
      const cross = labelOf(x.cross) || (link ? '대조 자료' : need('', '교차 검증 자료'));
      const fix = need(x.fix, '정정 내용');
      const loc = String(x.location || '').trim();
      const no = x.no ? `[원문 ${x.no}번째 문장] ` : '';
      // 정정 방식(fixMode): fix(고침, 기본) / delete(삭제) / soften(표현 완화). 고침 문장은 예전과 똑같이 둔다(발표 슬라이드에 들어감).
      const mode = modeOf(x);
      const body = mode === 'delete' ? `${cross}에서 직접 찾아보았으나 확인되지 않아 해당 내용을 삭제함`
        : mode === 'soften' ? `${cross}에서 근거를 확인할 수 없어 '${fix}'${josa(fix, '으로/로')} 표현을 완화함`
        : `${cross}${josa(cross, '을/를')} 직접 찾아 교차 검증한 후, ${fix}${josa(fix, '으로/로')} 정정함`;
      lines.push(`${circled(i + 1)} ${no}${body}${loc ? `, ${loc}에 반영` : ''}`);
      lines.push(`   대조 자료 링크: ${link || '(URL 또는 DOI 작성 필요)'}`);
    });
  } else {
    const src = need(d.compared, '대조한 자료');
    lines.push('[AI 답변의 문제점 발견]');
    lines.push(`확인이 필요한 주장 ${N}개를 ${src}${josa(src, '과/와')} 대조한 결과 실제와 다른 부분을 찾지 못함`);
    lines.push('[학생 주도적 수정 내용]');
    lines.push('해당 없음');
  }
  lines.push(`[최종 결론] ${need(d.conclusion, '최종 결론')}`);

  return [
    { key: 'ai', title: '1. 사용한 AI 정보(일시)', body: `${m.tool}${ver ? ` ${ver}` : ''}(${date || '날짜 미입력'} 사용)` },
    { key: 'purpose', title: '2. 활용 목적 및 범위', body: need(m.purpose, '활용 목적') },
    { key: 'conv', title: '3. AI 대화 내용', body: conv.join('\n') },
    { key: 'verify', title: '4. 단계별 비판적 검증 요약', body: lines.join('\n') },
  ];
}
