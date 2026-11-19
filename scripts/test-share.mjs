// 대화 공유 링크 → 도구 판별 테스트 (네트워크 없음)
// node scripts/test-share.mjs
import assert from 'node:assert/strict';
import { checkShareUrl } from '../lib/share.js';

assert.equal(checkShareUrl('https://chatgpt.com/share/6731-abcd')?.tool, 'ChatGPT');
assert.equal(checkShareUrl('https://chat.openai.com/share/abc')?.tool, 'ChatGPT');
assert.equal(checkShareUrl('https://gemini.google.com/share/abc123')?.tool, 'Gemini');
assert.equal(checkShareUrl('https://g.co/gemini/share/abc123')?.tool, 'Gemini');
assert.equal(checkShareUrl('https://claude.ai/share/1234-5678')?.tool, 'Claude');
assert.equal(checkShareUrl('https://www.perplexity.ai/search/abc.def')?.tool, 'Perplexity');
assert.equal(checkShareUrl('https://copilot.microsoft.com/shares/abc')?.tool, 'Copilot');
assert.equal(checkShareUrl('http://chatgpt.com/share/abc'), null, 'http 거부');
assert.equal(checkShareUrl('https://chatgpt.com.evil.com/share/abc'), null, '비슷한 주소 거부');
assert.equal(checkShareUrl('https://chatgpt.com/c/abc'), null, '공유가 아닌 대화 주소 거부');
assert.equal(checkShareUrl('https://chatgpt.com/share/abc?x=1#y')?.url, 'https://chatgpt.com/share/abc', '쿼리 제거');
assert.equal(checkShareUrl('그냥 글자'), null);
console.log('ok — 공유 링크 도구 판별 테스트 통과');
