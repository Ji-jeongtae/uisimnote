// '믿을 만한 곳에서 찾기' 사이트 목록 (브라우저·서버 공용).
// Gemini는 이 목록의 key만 고른다. 주소는 우리가 만든다 → 모델이 없는 URL을 지어낼 수 없다.
// search가 있으면 그 사이트 자체 검색, 없으면 Google의 site: 검색으로 그 사이트 안을 찾는다.

const enc = encodeURIComponent;

export const SITES = {
  riss: { name: 'RISS', domain: 'riss.kr', desc: '국내 학술논문·학위논문',
    search: (q) => `https://www.riss.kr/search/Search.do?isDetailSearch=N&searchGubun=true&query=${enc(q)}` },
  scholar: { name: 'Google Scholar', domain: 'scholar.google.com', desc: '국내외 논문·인용',
    search: (q) => `https://scholar.google.com/scholar?q=${enc(q)}` },
  kci: { name: 'KCI 학술지인용색인', domain: 'kci.go.kr', desc: '국내 등재 학술지 논문' },
  nl: { name: '국립중앙도서관', domain: 'nl.go.kr', desc: '책·보고서·정부 간행물' },
  kosis: { name: 'KOSIS 국가통계', domain: 'kosis.kr', desc: '국가 공식 통계 수치',
    search: (q) => `https://kosis.kr/search/search.do?query=${enc(q)}` },
  law: { name: '국가법령정보센터', domain: 'law.go.kr', desc: '법령 원문·시행일·개정 이력' },
  korea: { name: '대한민국 정책브리핑', domain: 'korea.kr', desc: '정부 정책·부처 발표' },
  dart: { name: 'DART 전자공시', domain: 'dart.fss.or.kr', desc: '기업 실적·사업보고서·공시' },
  kobis: { name: '영화관입장권 통합전산망', domain: 'kobis.or.kr', desc: '영화 관객 수·박스오피스' },
  bigkinds: { name: '빅카인즈 뉴스', domain: 'bigkinds.or.kr', desc: '국내 언론 기사 원문' },
};
export const SITE_KEYS = Object.keys(SITES);

export const siteSearchUrl = (domain, q) => `https://www.google.com/search?q=${enc(`site:${domain} ${q}`.trim())}`;
export const siteUrl = (key, q) => (SITES[key].search ? SITES[key].search(q) : siteSearchUrl(SITES[key].domain, q));

// 공식 사이트 도메인 검사: 경로·프로토콜 없이 도메인만, 목록에 있는 곳은 제외
const CATALOG_DOMAINS = new Set(Object.values(SITES).map((s) => s.domain));
export function cleanOfficial(list) {
  const out = [];
  for (const o of Array.isArray(list) ? list : []) {
    const domain = String(o?.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
    const name = String(o?.name || '').trim().slice(0, 30);
    if (!name || !/^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(domain) || CATALOG_DOMAINS.has(domain)) continue;
    if (out.some((x) => x.domain === domain)) continue;
    out.push({ name, domain });
  }
  return out.slice(0, 2);
}
