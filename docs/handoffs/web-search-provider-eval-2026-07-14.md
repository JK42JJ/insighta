# Web-Search Provider Evaluation — Book Research/Factcheck Evidence Source (2026-07-14)

Context: Google CSE (the provider CP458/CP504 code targeted) is **closed to new customers, dies 2027-01-01**; its
"entire web" option was discontinued for new engines 2026-03. Bing Web Search API died 2025-08-11. This forced a
full provider re-evaluation. Four parallel research tracks (independent-index APIs / Google-SERP resellers /
big-cloud+LLM-integrated / Korean-specific) ran on 2026-07-14; full agent reports preserved in session transcript.

## Workload (measured from code)

- Per book: research ≤6 queries (`book-research.ts MAX_GAPS=6`) + factcheck ≤24 (`fill-book.ts MAX_FACTCHECK_ATOMS=24`), each `num:3` results → **≤30 queries/book**
- Volume: now 16 books/wk ≈ **2.1k q/mo** · growth 100 books/day ≈ **90k q/mo** (3k/day) · max 1,000 books/day ≈ **900k q/mo** (30k/day)
- Pipeline is post-done async (background job) → latency-tolerant; batch/queued APIs acceptable

## Hard requirements

1. Korean quality (topics: 반려견 훈련, 라떼아트, JLPT, 재테크 …) — decisive axis
2. Evidence storable in our DB (`references[]`, `verification`) → **provider ToS on result storage matters**
3. Commercial use explicitly allowed; vendor continuity (two giants just exited this market)
4. Returns URL+title+snippet (plain REST preferred)

## Verdict matrix (all four tracks merged)

| Provider | /1k | Korean | Storage ToS | Continuity | Verdict |
|---|---|---|---|---|---|
| **Naver Open API** | free 25k/day | ◎ (native verticals: 웹문서·뉴스·백과·블로그·지식iN·책) | △ 저장/캐시 금지 조항 → URL+자체 클레임 저장으로 우회 | Naver; paid path = NCP API HUB | **채택 (1순위, 한국어)** |
| **Kakao Daum 검색** | free 50k/day (30k/vertical) | ◎ | ○ "상업적 제한 없음" 공식 답변; 캐싱은 UX 목적 | Kakao | **채택 (2순위/폴백)** |
| **ko.wikipedia MediaWiki** | free (200 req/min w/ UA) | ○ 백과형 한정 | ◎ CC BY-SA 4.0 저장 가능 | Wikimedia | **채택 (백과 보조)** |
| **국립국어원 우리말샘/krdict** | free 50k/day | ◎ 용어/언어 | ◎ CC BY-SA 상업 명시 | 정부 | **채택 (언어학습 팩트체크)** |
| Perplexity Search API | $5 | ◎? SKT 협업 실증 최강(간접) | UNVERIFIED — 계약 전 확인 필수 | $18B+, 견고 | **글로벌 폴백 후보 A** |
| DataForSEO (Standard queue) | $0.60 async | ○ Google SERP + Naver SERP 겸용 | 공급자 제한 없음(스크래핑 그레이) | 2016~, 무소송 | **글로벌 폴백 후보 B** |
| Serper.dev | $0.75–1 | ○ gl=kr | 제한 없음(스크래핑 그레이) | 소기업, 크레딧 6개월 만료 | 예비 |
| Tavily | $8 | △ 한국어 truncation 이슈(#29) | ZDR/SOC2 | Nebius 인수 | 보류 |
| Exa / OpenRouter 웹플러그인 | $5–7 | ✗ 영어 중심, 한국어 미실증 | Exa ToS 재판매 제한 | $2.2B | 탈락(한국어) |
| Brave | $5 | ✗ 취약 + 무료티어 폐지(2026-02) | ✗ **기본 저장 금지**(transient only) | Anthropic 백엔드 | **탈락** |
| Gemini Grounding | $14(쿼리 과금) | ◎ 구글 실검색 | ✗ redirect URL 수일 만료 + 표시요건 + 30일 보관 | Google | 탈락(증거 저장 부적합) |
| MS Bing Grounding | $14 | ○ | ✗ **저장·DB화 명문 금지** | Bing API는 사망 | **탈락(약관)** |
| AWS AgentCore Web Search | $7 | ? 신규 인덱스 미실증 | 원시결과 반환, 제한 미발견 | GA 2026-06, us-east-1만 | 관망 |
| SerpApi | $9+ | ○ (+Naver 전용 API) | Legal Shield(수집만) | ✗ **Google이 DMCA 제소 중**(2025-12) | 탈락(소송 당사자) |
| Kagi / You.com / Jina / Mojeek | $12/$5/$0.5/$2.6 | ?/?/○간접/✗ | 각기 | Jina=Elastic 인수 리스크 | 예비 |
| SearXNG 자가호스팅 | 서버비 | ○ | — | ✗ Google이 5쿼리만에 차단(fingerprinting) | 탈락(상용 부적합) |

Key market facts: Google v. SerpApi (DMCA, 2025-12) pends — SERP-scraping category re-pricing risk H2 2026.
Brave = Anthropic web_search의 백엔드(한국어 한계 공유).

## Recommended architecture

`src/modules/web-search/` provider-abstraction ( `searchWeb(query, opts)` 인터페이스는 기존 CSE 클라이언트와 동일 계약 ):

1. **Naver Open API** — primary (웹문서+백과+뉴스+블로그 merge), free 25k/day covers growth scenario (3k/day)
2. **Kakao Daum** — fallback + 보충, free 50k/day
3. **ko.wikipedia + 국립국어원** — encyclopedic/terminology claims, CC-licensed (저장 무제한)
4. 유료 글로벌 폴백(Perplexity vs DataForSEO)은 **한국어 3종 실측 후** 필요 시 결정 — 베타 볼륨에선 불필요 가능성

Storage policy (Naver ToS 대응 + data-write hard rule 정합): evidence rows = **URL + title + 자체 작성 클레임 요약**.
Naver `description` verbatim 장기 저장 금지. CC 소스(위키/국어원)만 스니펫 저장 허용.

Scale path: 1,000 books/day 도달 시 Naver 25k/day 초과 → NCP API HUB 종량 전환 or 유료 폴백 확대 (그 시점 재평가).

## Execution plan

- Phase 1: James — developers.naver.com + developers.kakao.com 앱 등록(무료, 카드 불필요, 즉시 발급) → 키 4개
  (NAVER_SEARCH_CLIENT_ID/SECRET Secret, KAKAO_REST_API_KEY Secret)
- Phase 2: CC — web-search 모듈 + 실제 북 주제 50쿼리 벤치(Naver/Kakao/Wiki) → 품질 보고 → book-research/factcheck 스왑 PR
  (+ PR #1234 재작업: GOOGLE_CSE 배선 제거, 새 키 deploy 계약 테스트 + loud-warn 유지)
- Phase 3: 실측 기반 글로벌 폴백 결정 (필요 시)
