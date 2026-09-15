# WO-2026-09-15 브리프 페이지: 목차 라벨(navLabel) · 이 호에 질문(Ask)

Status: design — James 결정 대기 (2026-09-15 16:20 KST). 착수는 2호 발송 뒤.

# 목표

1. 좌측 브리프 목차의 스토리 제목이 `...` 으로 잘리지 않게 한다. 러닝 페이지와 같은 원칙(사이드바만 짧게, 본문 제목은 그대로)을 데이터로 고정한다.
2. 브리프 페이지 우측에 "이 호에 질문" 패널을 둔다. 답은 이번 호 본문과 출처에만 근거한다(상위 명세 §12: 근거 없는 사실·출처 없는 숫자 생성 금지).

# 맥락 — 코드 실측 (2026-09-15)

## 목차 라벨

| 사실 | 근거 |
|---|---|
| 브리프 목차는 이미 러닝 페이지와 같은 축약 함수 `tocShortLabel` 을 쓴다. 구분자(`: ： — – · |`) 앞부분만 남긴다 | `frontend/src/pages/learning/lib/toc-label.ts:7`, `SidebarBriefSection.tsx:166,186` |
| 스토리 제목은 편집 페르소나 규칙상 평서문이고 줄표를 쓰지 않는다. 구분자가 없으므로 축약 함수는 통과시키고 1줄 `truncate` 가 `...` 을 만든다 | 로컬 스펙 `docs/spec/weekly-brief/editorial-persona-v1.md:42,77,96`; v2 게이트 `title-shape` 는 줄표를 경고 |
| 라벨 텍스트와 식별자는 분리돼 있다. 렌더는 `tocShortLabel(e.label)`, 활성 판정과 스크롤은 원문 `e.label`(제목 텍스트로 heading 탐색) | `SidebarBriefSection.tsx:156,173,174,186`, 텍스트 매칭 근거 `:79-84` |
| `IssueDocumentSchema` 는 알 수 없는 키를 제거한다(`passthrough` 없음). 공개 라우트가 다시 파싱하므로 스키마에 없는 필드는 프론트에 도달하지 않는다 | `src/modules/newsletter/issue-schema.ts:118`, `src/api/routes/brief.ts:362` |
| 프론트는 `Story` 타입을 손으로 미러한다 | `frontend/src/features/newsletter-note/lib/issue-types.ts:33-37` |
| 스토리 `kicker`·`title` 은 LLM 이 쓰지 않는다. S7 은 `kind: 'person'` 이고 `stories` 는 `awaitingEditor` | `src/modules/newsletter/pipeline/stages/s7-draft.ts:8-13,93-95,229` |
| 발행된 호 편집 경로가 있다: 관리자 JSON 편집기 → `PUT /api/v1/admin/newsletter/issues/:id` → 검증 → `clearBriefCache()` | `frontend/src/pages/admin/ui/AdminNewsletter.tsx:70-92`, `src/api/routes/admin/newsletter.ts:241,294` |
| 저장소의 1호 JSON 은 라이브 행과 제목 형태가 다르다(파일: 줄표 제목, DB: 평서문 제목). 테스트가 이 파일을 파싱한다 | `src/modules/newsletter/issues/2026-09-02-ai-tech.json`, `tests/unit/modules/newsletter-render-surfaces.test.ts:29` |
| 사이드바 어디에도 2줄 clamp 는 없다. 모든 목차 행은 1줄 `truncate` | `frontend/src/widgets/app-shell/**` grep |
| 호 행은 `issueLabel` + `headline` 1줄 truncate | `SidebarBriefPanel.tsx:188-189` |
| 모바일 드로어는 같은 `SidebarBriefPanel` 을 렌더한다 | `MobileDrawer.tsx:147-156` |

## 이 호에 질문

| 사실 | 근거 |
|---|---|
| 제품 챗 엔드포인트 `/api/v1/chat` 은 CopilotKit 이 Node HTTP 서버에 직접 붙인 리스너다. Fastify 인증·레이트리밋 플러그인을 우회한다 | `src/api/routes/copilotkit.ts:203-210` |
| 인증은 헤더에서 신원을 뽑아 프롬프트를 풍부하게 할 뿐, 검증 실패도 답한다(사실상 무인증) | `copilotkit.ts:123-152` |
| 사용자별 리밋은 없다. `checkUserRateLimit` 은 정의만 있고 호출자 0 | `src/modules/llm/cost-gate.ts:249` |
| 원장 `llm_call_logs` 는 `module: 'copilotkit'` 로 쓰이며 `user_id` 가 null 이다 | `src/modules/chatbot-rag/qwen-prompt-middleware.ts:186-197`, `src/modules/llm/call-logger.ts:65-77` |
| 스펙의 챗봇 행은 maintenance 이고, 유일한 미결 수용 기준이 "사용자별 리밋 배선(보안 Stage 2)" | 로컬 스펙 `docs/spec/README.md:28` |
| 컨텍스트 종류는 프론트가 보낸 시스템 프롬프트를 정규식으로 파싱해 정한다(`VIDEO_ID_REGEX` 등). 종류 추가 지점 16곳: `ChatLayer`·`BlockId`·`LAYER_BLOCKS`·로더·정규식·프론트 `computeChatLayer` 등 | `prompt-builder.ts:37,195-246,617-641,695-777`, `qwen-prompt-middleware.ts:59-87,457-539`, `ChatAssistant.tsx:21,38-56` |
| 러닝 페이지 `ChatAssistant` 는 러닝 스토어 8개 훅·플레이어·seek 에 결합돼 있어 그대로 재사용할 수 없다 | `ChatAssistant.tsx:290-330,449-457` |
| 브리프 페이지는 본문 열(`max-w-[720px]`)뿐이고 우측 구조가 없다. AppShell 에 우측 슬롯도 없다(러닝의 400px 우측 패널은 `LearningPage` 소유) | `BriefNotePage.tsx:104-106`, `AppShell.tsx:173-175`, `RightPanel.tsx:126` |
| 재사용 가능한 프리미티브: `shared/ui/sheet.tsx`(우·하 변형), 드로어/플로팅 버튼 컴포넌트는 없음 | `frontend/src/shared/ui/sheet.tsx:39-44` |
| 상위 명세에 독자 Q&A 는 없다. 원칙: "AI 가 콘텐츠를 만들게 하지 말고, 편집자의 판단을 보조하게 한다"(§, 1000행), §12 근거 없는 사실 생성 금지 | `docs/handoffs/weekly-knowledge-brief-master-spec.md:1000` |
| 픽 영상의 v2 요약·자막 로더가 이미 있다 | `src/modules/chatbot-rag/video-context-loader.ts` |

# 설계 1 — 목차 라벨 `navLabel`

## 1.1 데이터

- `StorySchema` 에 `navLabel: z.string().min(2).max(NAV_LABEL_MAX).optional()` 추가. `NAV_LABEL_MAX = 18`(한글 기준. 사이드바 320px, 13px 글꼴, 들여쓰기·여백 제외 가용 폭 약 250px = 약 19자).
- 프론트 미러 `issue-types.ts` 의 `Story` 에 `navLabel?: string`.
- 편집 규칙(편집 페르소나 스펙에 한 줄 추가): 명사구, 마침표·줄표 없음, 제목의 대상 + 핵심 동작. 본문 제목은 그대로 평서문.
- 발행 게이트: `publishBlocker` 에 "모든 `stories[].navLabel` 존재" 조건 추가(발행 시점만. 초안은 없어도 저장 가능). S7 `awaitingEditor` 에 `stories[].navLabel` 추가해 편집자 체크리스트에 뜨게 한다.

## 1.2 표시

- `SidebarBriefSection` `Entry` 에 `navLabel?` 추가, `toEntries` 에서 `s.navLabel` 전달.
- 렌더(`:186`)만 `e.navLabel ?? tocShortLabel(e.label)` 로 바꾼다. 활성 판정·스크롤·`onSelect` 는 원문 `e.label` 그대로(식별자 불변). `li` 에 `title={e.label}` 을 붙여 전체 제목을 툴팁으로 남긴다. `truncate` 유지.
- 호 행(`SidebarBriefPanel.tsx:188-189`): 1줄 = `issueLabel` + 발행일(월 일), 2줄 = `headline[0]` 을 `line-clamp-2`, 12.5px. 호 목록에서 식별자는 호수·날짜이고 헤드라인은 보조 정보이므로 2줄로 내린다. 목차 행에는 clamp 를 쓰지 않는다(사이드바 규칙 1줄 유지).
- 모바일 드로어는 같은 컴포넌트라 자동 반영.

## 1.3 1호 백필 (LLM 없음)

- 경로: 관리자 화면 뉴스레터 JSON 편집기에서 4개 story 에 `navLabel` 추가 → PUT → 캐시 무효화 자동.
- 되돌림: PUT 전 `GET /admin/newsletter/issues/:id` 응답을 파일로 저장(스냅샷). 롤백 = 그 문서를 다시 PUT.
- 저장소 파일 `issues/2026-09-02-ai-tech.json` 은 라이브 행과 다르므로 백필 뒤 DB 문서를 내려받아 파일을 동기화하고 같은 PR 에 커밋한다.
- 라벨 문안 제안(James 확정 필요):

| 스토리 제목(라이브) | navLabel 제안 |
|---|---|
| Claude Code는 저장소 설정 파일에 든 명령을 사용자 확인 없이 실행했습니다 | 저장소 설정 파일의 숨은 명령 |
| PayPal은 에이전트가 물건을 고르기 전에 사용… | PayPal 사전 승인 토큰 |
| 환불 요청이 타임아웃되면 에이전트는 재시도하… | 환불 타임아웃과 재시도 |
| 이번 주 조회수는 54GB 모델을 8GB 그래픽카… | 54GB 모델을 8GB 카드에 |

## 1.4 기각한 대안

- 목차 행 2줄 clamp: 데이터 변경 없이 되지만 사이드바 1줄 규칙과 어긋나고, 긴 제목은 2줄에서도 잘린다. 호 행에만 쓴다.
- 첫 절에서 자르는 휴리스틱: 한국어 평서문에서 뜻이 깨진다.
- heading `id` 앵커: 2026-09-07 설계에서 빠진 항목. 텍스트 매칭이 이미 동작하므로 이 오더의 범위 밖.

## 1.5 작업 단위

PR 1개(백엔드 스키마·게이트·S7 목록 + 프론트 타입·렌더·호 행 + 테스트 갱신 + 1호 JSON 동기화). 갱신 대상 테스트: `SidebarBriefSection.test.tsx`(라벨 우선순위·`li` truncate·활성/스크롤은 원문), `SidebarBriefPanel.test.tsx`(중첩 라벨·호 행 2줄), `newsletter-render-surfaces.test.ts`(파일 파싱), `newsletter-render-web.test.ts`(선택 필드 통과), `brief-routes.test.ts`. 규모 약 2시간 + /verify.

# 설계 2 — 이 호에 질문 (Ask)

## 2.0 전제 PR — 챗 가드 (브리프에 붙이기 전에 필요)

primary 표면에 무인증·무리밋 엔드포인트를 노출하지 않는다. 러닝 페이지 챗도 같은 가드를 받는다(프론트는 이미 항상 토큰을 보내므로 체감 변화 없음).

- `/api/v1/chat` 리스너: 유효한 JWT 없으면 401. 지금은 검증 실패도 답한다.
- 사용자별 리밋: 리스너에서 `checkUserRateLimit(userId)` 호출(정의 존재, 호출자 0). 초과 시 429 + 한국어 안내. 상한 `USER_RATE_LIMIT_PER_HOUR` 기본 20(James 결정).
- 원장: `logLLMCall` 에 `user_id` 와 `metadata: { layer, slug? }` 를 넣는다(AsyncLocalStorage 컨텍스트에서 읽음). 이것으로 스펙 챗봇 행의 미결 항목(보안 Stage 2)이 닫힌다.
- 테스트: 무토큰 401, 초과 429, 원장 행에 user_id.

## 2.1 백엔드 — `brief` 컨텍스트 층

- `ChatLayer` 에 `'brief'`, `BlockId` 에 `'brief_issue'`, `types.ts` 에 `BriefContext { slug, issueLabel, categoryLabel, headline, stories[{kicker,title,navLabel,text}], picks[{title,videoId,summary?}], refs[{label,sources}] }`.
- 로더 `brief-context-loader.ts`: `newsletter_issues` 를 slug 로 읽되 `published_at IS NOT NULL` 만. 픽의 `videoId` 는 `loadCachedVideoContext` 로 요약을 붙이되 픽당 상한(약 600자)과 총 상한(약 2,000자)을 둔다. 본문 4편 × 최대 1,200자 + 요약 = 약 8k 토큰.
- 프론트 마커: 시스템 프롬프트에 `[[brief:<slug>]]`. 미들웨어에 `BRIEF_SLUG_REGEX` 추가(기존 `VIDEO_ID_REGEX` 와 같은 방식). 로더는 `Promise.all` 에, 층 선택 삼항 연쇄에 `brief` 분기, `LAYER_BLOCKS`·`LAYER_BLOCKS_FALLBACK`·`deriveTrainingLayer` 갱신.
- 프롬프트 블록 규칙(§12 준수): 이번 호 본문과 출처 목록 안에서만 답한다. 어느 스토리(kicker) 근거인지와 출처 등급(확인/영상)을 함께 말한다. 호 밖 질문이면 "이번 호에서 다루지 않았다" 고 말하고 가장 가까운 스토리나 출처를 가리킨다. 본문에 없는 숫자·날짜를 만들지 않는다. 존댓말, 6문장 이내.
- 테스트(LLM 호출 없음): 로더(prisma mock, 미발행 slug → null), 정규식 파서, 프롬프트 블록 텍스트, 층 선택.

## 2.2 프론트 — 패널

- 새 컴포넌트 `features/brief-ask/ui/BriefAskPanel.tsx`. CopilotKit 마운트(`runtimeUrl='/api/v1/chat'`, 토큰 헤더, `instructions` 에 마커+slug)와 최소 메시지 UI 만. `ChatAssistant` 는 재사용하지 않는다(러닝 스토어 결합).
- 제안 칩: "이번 호를 세 문장으로", 스토리별 "'{navLabel}' 근거가 뭔가요?"(최대 4), "출처 목록". 안내 한 줄: "답변은 이번 호 본문과 출처에 한정됩니다."
- 배치: 데스크톱 1440px 이상 = `BriefNotePage` 안 우측 400px 열(러닝 `RightPanel` 과 같은 폭), **기본 접힘**(우측 44px 레일의 "질문" 버튼). 1440px 미만 = `Sheet side="right"`. 모바일 = `Sheet side="bottom"`, 높이 70vh. 열림 상태는 localStorage 에 보관(뷰어 편의, 없어도 동작).
- AppShell 무변경(패널은 페이지 소유). 사이드바 자동 접힘 규칙은 건드리지 않는다(1440 미만은 오버레이라 충돌 없음).
- 노출: 로그인 사용자 전원(구독자 한정은 James 결정). 미발행·미존재 slug 는 패널 없음.
- 플래그: 프론트 `VITE_BRIEF_ASK`(미설정 = 숨김). 백엔드 층은 마커가 없으면 비활성이라 플래그 불필요.
- 테스트: `chat-layer.test.ts` 에 `brief`, 패널이 navLabel 로 칩을 만드는지, 기본 접힘, 좁은 폭에서 Sheet. api-client 변경 없음(계약 테스트 무영향).

## 2.3 지표

`llm_call_logs` 의 `metadata.layer='brief'`·`slug`·`user_id` 로 호별 질문 수를 센다. 4주 지표(열람·유지·답장·해지)에 "질문 수/호" 를 더한다. Keel `llm-spend` 는 그대로 이 호출을 포함한다.

## 2.4 범위 밖

지난 호 교차 검색(보관소·검색 표면, planned), 세션 간 대화 기억, 편집자용 AI, 댓글·답장.

## 2.5 작업 단위와 순서

PR-Q0 가드(반나절) → PR-Q1 백엔드 층(반나절) → PR-Q2 프론트 패널(반나절~1일). 합계 1.5~2일. 착수는 2호 발송 뒤. 롤백: Q0 는 리스너 조건 되돌림, Q1 은 마커 없으면 무효, Q2 는 플래그 해제.

# 제약

- 렌더러·파이프라인의 글쓰기 단계는 바꾸지 않는다(제목·라벨은 사람이 쓴다). LLM 호출은 사용자 질문에서만 발생한다.
- 데이터 쓰기는 스냅샷 + 롤백 동봉(1.3). prod 데이터 편집 실행은 James 결정.
- 머지는 `merge-green.sh`(R31). 프론트 변경은 /verify 후 푸시.
- 브랜드 표면 이모지 없음. 카피는 기술 용어.

# 검증 기준

- 목차: 1호·2호에서 `...` 이 0건(사이드바·모바일 드로어), 클릭 시 본문 heading 으로 스크롤, 활성 표시 유지. 관리자 미리보기 422 없음. `GET /brief/:slug/document` 응답에 `navLabel` 포함.
- 질문: 무토큰 401, 21번째 질문 429, 호 밖 질문에 "다루지 않았다" 응답, 답변에 출처 등급 표기, 원장 행에 user_id·slug. 러닝 페이지 챗 회귀 없음.

# James 결정

1. `navLabel` 최대 18자와 1.3 의 문안 4개 확정.
2. 1호 백필 실행 주체: 관리자 화면에서 직접 vs CC 가 PUT(스냅샷 동봉).
3. 호 행 2줄 표시안(1.2) 승인.
4. 질문 노출 대상(로그인 전원 / 구독자), 시간당 상한(기본 20), 데스크톱 기본 접힘.
5. 순서 확정: 2호 발송 → 설계 1 PR → Q0 → Q1 → Q2.

# 결과

(설계 단계 — 미착수)
