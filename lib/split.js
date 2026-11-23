// AI 답변을 문장 단위로 나눈다 (브라우저·Node 공용).
// 반환: [{ id, text, para, prefix }]  para = 문단 번호, prefix = 목록 기호(화면 표시용)

const ABBR = /(?:\bet al|\be\.g|\bi\.e|\bvs|\bDr|\bProf|\bMr|\bMs|\bNo|\bVol|\bpp?|\bFig|\bcf|\bU\.S|(?:^|[\s(])[A-Z])$/;

function cleanLine(line) {
  return line
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^>\s?/, '');
}

function splitLine(text) {
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!'.!?。…'.includes(ch)) continue;
    // 문장부호 뒤 닫는 따옴표·괄호까지 포함
    let j = i + 1;
    while (j < text.length && /["'”’)\]」』]/.test(text[j])) j++;
    if (j < text.length && !/\s/.test(text[j])) continue; // 3.5, a.b 같은 경우
    if (ch === '.') {
      const before = text.slice(start, i);
      if (ABBR.test(before)) continue; // et al. 등 약어
      if (/(^|\s)\d{1,3}$/.test(before) && /^\s*\d/.test(text.slice(j))) continue;
      if (/^\s*\d{1,2}$/.test(before)) continue; // 줄 중간의 "3." 같은 번호
    }
    const piece = text.slice(start, j).trim();
    if (piece) out.push(piece);
    start = j;
  }
  const rest = text.slice(start).trim();
  if (rest) out.push(rest);
  return out;
}

export function splitSentences(answer) {
  const lines = String(answer || '').replace(/\r\n?/g, '\n').split('\n');
  const result = [];
  let para = 0;
  let prevBlank = false;
  let id = 1;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { prevBlank = true; continue; }
    if (/^[-*_=]{3,}$/.test(line)) { prevBlank = true; continue; } // 구분선
    if (result.length && prevBlank) para++;
    prevBlank = false;
    const m = line.match(/^((?:[-*•·]|\d{1,2}[.)]|[①-⑳]|[가-하][.)])\s+)/);
    const prefix = m ? m[1].trim() : '';
    const body = cleanLine(m ? line.slice(m[0].length) : line);
    const parts = splitLine(body);
    parts.forEach((text, k) => {
      result.push({ id: id++, text, para, prefix: k === 0 ? prefix : '', lineStart: k === 0 });
    });
  }
  return result;
}

// 형광펜 범위를 띄어쓰기 단위(어절) 경계로 넓힌다. 앞뒤 공백은 빼고, 단어 중간에서 시작·끝나면 그 단어 전체로.
export function snapToWords(text, start, end) {
  const t = String(text || '');
  let a = Math.max(0, Math.min(start, end)), b = Math.min(t.length, Math.max(start, end));
  while (a < b && /\s/.test(t[a])) a++;
  while (b > a && /\s/.test(t[b - 1])) b--;
  if (b <= a) return null;
  while (a > 0 && !/\s/.test(t[a - 1])) a--;
  while (b < t.length && !/\s/.test(t[b])) b++;
  return { start: a, end: b };
}
