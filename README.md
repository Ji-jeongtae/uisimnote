# 의심노트

AI 자료조사 답변에서 확인할 곳을 스스로 찾아보는 연습을 하고, 직접 검증한 기록을 명지대 'AI 활용 서면 증빙서' 형식으로 정리하는 웹 서비스.
2026학년도 명지대 AI 리터러시 경진대회 결선 출품작입니다(팀 더블체크).

- **AI는 판정하지 않습니다.** Gemini는 주장 유형(확인 필수·확인 권장·참고)만 분류합니다. 참·거짓은 학생이 출처를 찾아 판단합니다.
- **도움은 점점 줄어듭니다.** 학생이 AI 표시를 보기 전에 먼저 의심할 문장을 고르고, '먼저 의심한 비율'이 기록됩니다.

## 구조
| 파일 | 역할 |
|---|---|
| `index.html`, `style.css`, `app.js` | 화면 5단계 (빌드 없는 정적 파일) |
| `lib/split.js` | 답변을 문장 단위로 나누기 (브라우저·Node 공용) |
| `lib/prompt.js` | **분류 프롬프트**, 응답 스키마, Gemini 호출 (`PROMPT_VERSION`) |
| `prompts/CHANGELOG.md` | 프롬프트 버전별 입력 예·문제·수정 기록 |
| `api/classify.js` | Vercel 서버리스 함수. API 키는 서버 환경변수에만 둠 |
| `demo.json` | 시연 모드용 예시 답변과 저장된 분류 결과 |
| `scripts/run-prompt.mjs` | 프롬프트 실험(반복 실행·일관성·판정 표현 검사), 결과는 `prompt-log/`에 저장 |
| `dev-server.mjs` | 로컬 개발 서버 (키가 없으면 MOCK 분류) |

## 로컬 실행
```
copy .env.example .env      # GEMINI_API_KEY 입력 (없으면 MOCK 모드)
node dev-server.mjs         # http://localhost:3000
node scripts/test-split.mjs # 문장 나누기 테스트
```

## 배포 (Vercel)
1. GitHub에 이 폴더를 저장소로 올린다 (`.env`는 `.gitignore`에 들어 있어 올라가지 않음).
2. vercel.com → Add New → Project → GitHub 저장소 Import. Framework Preset: **Other**, Build Command 비움.
3. Settings → Environment Variables에 `GEMINI_API_KEY`(필수), `GEMINI_MODEL`(선택, 기본 `gemini-2.5-flash`) 추가 → Redeploy.

## 시연 모드
주소 뒤에 `?demo`를 붙이면 예시 답변의 분류를 API 호출 없이 저장된 결과로 보여 준다(화면 상단에 '시연 모드' 표시).
인터넷이나 API가 실패할 때를 대비한 백업이다. `node scripts/run-prompt.mjs --demo`로 저장된 결과를 실제 Gemini 결과로 바꾼다.

## 프롬프트 기록
```
node scripts/run-prompt.mjs tests/answer01.txt --runs 3
```
txt 첫 줄을 `Q: 원래 질문` 형식으로 쓰면 질문으로 사용한다. 프롬프트를 고치면 `lib/prompt.js`의 `PROMPT_VERSION`을 올린다.

## AI 사용 고지
- 기획 정리·코드 작성: Claude, Claude Code
- 주장 유형 분류(서비스 기능): Google Gemini API
- 테스트용 AI 답변 생성: ChatGPT(무료)
