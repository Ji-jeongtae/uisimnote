// Vercel 서버리스 함수: POST /api/classify
// GEMINI_API_KEY는 Vercel 환경변수에만 둔다(코드·화면 노출 금지).
import { PROMPT_VERSION, validateInput, classifyWithGemini } from '../lib/prompt.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'POST만 지원합니다.' });
  }
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  if (!apiKey) return res.status(500).json({ error: '서버에 Gemini API 키가 설정되지 않았습니다.' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const invalid = validateInput(body);
  if (invalid) return res.status(400).json({ error: invalid });

  try {
    const result = await classifyWithGemini(body, { apiKey, model });
    return res.status(200).json({
      items: result.items,
      missing: result.missing,
      model,
      promptVersion: PROMPT_VERSION,
      at: new Date().toISOString(),
    });
  } catch (e) {
    console.error(e);
    const status = e.status === 429 ? 429 : 502;
    const msg = status === 429
      ? 'Gemini 무료 사용량을 잠시 초과했습니다. 1분 뒤 다시 시도하거나 시연 모드를 쓰세요.'
      : 'AI 분류 서버와 연결하지 못했습니다. 다시 시도해 주세요.';
    return res.status(status).json({ error: msg });
  }
}
