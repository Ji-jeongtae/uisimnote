// 대화 공유 링크 → 사용한 AI 도구 (브라우저에서만, 서버 요청 없음)
// 공유 페이지의 대화 내용은 읽지 않는다: ChatGPT는 브라우저가 아닌 요청에 내용 없는 안내 페이지만 주고
// (2026-11-19 실제 링크로 확인), 브라우저인 척해 받아 오는 것은 사이트의 봇 차단을 우회하는 일이라 하지 않는다.
// 대화 내용은 학생이 공유 페이지에서 드래그해 붙여 넣는다(app.js parseConversation이 나눔).

export const SHARE_HOSTS = [
  { re: /^(?:www\.)?(?:chatgpt\.com|chat\.openai\.com)$/, path: /^\/share\/[\w-]+\/?$/, tool: 'ChatGPT' },
  { re: /^gemini\.google\.com$/, path: /^\/share\/[\w-]+\/?$/, tool: 'Gemini' },
  { re: /^g\.co$/, path: /^\/gemini\/share\/[\w-]+\/?$/, tool: 'Gemini' },
  { re: /^claude\.ai$/, path: /^\/share\/[\w-]+\/?$/, tool: 'Claude' },
  { re: /^(?:www\.)?perplexity\.ai$/, path: /^\/search\/[\w.-]+\/?$/, tool: 'Perplexity' },
  { re: /^(?:www\.)?copilot\.microsoft\.com$/, path: /^\/shares\/[\w-]+\/?$/, tool: 'Copilot' },
];

export function checkShareUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const h = SHARE_HOSTS.find((x) => x.re.test(u.hostname) && x.path.test(u.pathname));
  return h ? { url: `https://${u.hostname}${u.pathname}`, tool: h.tool } : null;
}
