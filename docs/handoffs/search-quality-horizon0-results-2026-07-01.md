# [세션 핸드오프] 검색품질 트랙 · 지평 0 실측 결과 (M1~M4) — 2026-07-01

> 이 문서 = 다음 세션에서 검색품질 트랙을 이어가기 위한 완전한 인수인계.
> SSOT 3종: 이 결과표 + `docs/design/card-quality-search-overhaul-2026-07.md`(종합 리포트) + `~/Downloads/insighta-search-quality-master-plan-2026-07.md`(마스터플랜).
> 원칙: **measure-gated** — 지평 1 스코프는 아래 M1~M4 실측 위에서만 확정된다.

---

## 0. 지금 어디에 있나 (한 줄)

**지평 0(M1~M4 read-only 실측)을 거의 완주. M2(커버리지 갭 맵)만 남았고, 이후 지평 1(회수·서빙·표적수집) 스코프를 확정하면 됨.** James가 "유튜브 검색 개선 실험" 엔지니어링 글을 쓸 예정 → 모든 산출물은 측정 기반·글쓰기용 엄밀성 필요.

---

## 1. 문제 정의 (왜 이 트랙인가)

카드 검색이 **① <50개 (수량 부족) + ② 품질 저하 (동일 채널 도배 5/45, 2~12년 outdated 카드, 중복 추천)**. James가 320개 풀에서 "대중 주워주는 느낌"이라 지적. 근본은 "풀 4만인데 pool-serve가 극히 일부만 봄" + "품질/신선도/다양성 게이트 부재".

**전략 2-prong (잠정 확정):**
- **Prong A (랭킹)**: **Typesense** 도입 — 별도 리포, 하이브리드 RRF + native field-collapse(채널 그룹) + recency decay + 캐시. **⚠️ insighta 리포와 절대 교차 금지.**
- **Prong B (공급+≥50 보장)**: insighta 리포 내에서 수율 회수 + 표적 수집 + reconciler.

---

## 2. 지평 0 실측 결과 (M1~M4) — ★핵심 산출물

### M1 · 4만 풀 서빙 자격 회수 퍼널 ✅ 완료
```
전체 풀                          40,074
  ├─ 만료/비활성 (TTL)           26,901  (67%)  ← 최대 사장 원인
  └─ 활성(is_active)             13,173
        ├─ gold/silver 활성      11,482
        │     ├─ 임베딩 있음      4,460  ← ★회수 가능 서빙 풀(현실적 상한)
        │     └─ 미임베딩         7,022  ← ★임베딩 백필 = 최대 레버
        └─ (bronze/untiered)      ~1,691
현재 pool-serve 가시 (source=['v2_promoted'] 하드코딩)  1,177
```
**회수 레버 2개 (둘 다 YouTube 쿼타 0):**
1. **소스 확대** `['v2_promoted']` → gold/silver 전체: 1,177 → **4,460 (3.8×)**.
   - ⚠️ **단, 무료 upside 아님.** `v2_promoted` 제한은 **의도적 anti-noise**였음(hybrid-rerank.ts:156-220 주석: cell 6 = "28 토익스피킹 at cosine 0.55+ under all-source" 사고). 소스 확대 = 관련도 게이트(gc≥60) 동반 필수.
2. **임베딩 백필** 7,022개(활성 gold/silver 미임베딩): RunPod, YouTube 쿼타 0 → 시맨틱 매칭이 "보게" 만듦. **소스확대보다 큰 레버.**
- **반증됨**: 핸드오프 초기 가정 "~11.4k 회수 가능" → M1 실측 = 임베딩된 건 4,460뿐. TTL 만료 67%가 지배적.

### M2 · 커버리지 갭 맵 ⏳ **미완 (다음 세션 첫 작업)**
- **소스 확정**: `mandala_embeddings` 테이블 = 셀 임베딩 보유. 컬럼: `id, mandala_id, level, sub_goal_index, text, embedding, language, domain, center_goal, center_label, sub_goal, sub_label`.
- **할 일**: 코어 만다라(영문법·코딩테스트·재테크·K8s 등 실재)의 **셀별로**, 회수 가능 풀(활성 gold/silver 임베딩=4,460) 대비 cosine 매칭 후보 수 카운트. cosine을 gc 대리지표로 사용(gc는 LLM 필요 → read-only 불가). `<N`인 셀 = 커버리지 갭 = W3 표적수집 대상.
- read-only pgvector. 쓰기·배포 0.

### M3 · 도메인별 신선도 (volatile vs evergreen) ✅ 완료 (title 휴리스틱 우회)
- ⚠️ `user_mandalas.volatility` = **전부 NULL (2,236개)**, `content_type`도 활성풀 13,170 중 대부분 null → 필드 기반 split 불가. **코어 만다라 배치카드 발행일 + 제목 휴리스틱**으로 우회.
- ★결과: **volatile/기술 도메인이 심각하게 노후:**

| 만다라 | >6mo | >2yr | 장수 |
|---|---|---|---|
| **K8S 전문가 되기** | **93.3%** | **81.7%** | 60 |
| K8s 상용 서비스 운영 | 87.3% | 78.2% | 55 |
| 울트라러닝 AI 전문가 | 92.6% | 59.3% | 54 |
| AI 시대 뇌 활용법 | 83.3% | 43.3% | 60 |
| 생성형 AI 부수입(N잡) | 79.3% | 28.1% | 121 |
| AI 와 미래학 통찰 | 71.9% | 29.7% | 64 |
| ETF 투자 노후자산 | 69.1% | 12.3% | 162 |
| learn ai in 2026 | 58.1% | 12.9% | 62 |
| AI 에이전트 업무자동화 | 52.9% | 9.3% | 172 |
| Google One AI 프로젝트 | 24.0% | 15.5% | 129 |

- **결론**: K8s(2년+ 82%)처럼 낡으면 obsolete한 기술 도메인일수록 노후 극심 → 신선도 개입은 **volatile 표적**(랭킹 신선우선 + volatile 신선수집). evergreen(영문법)은 상대적 무해 → volatility-aware 처리가 정답.

### M4 · 컴플라이언스 / 쿼타 상태 ✅ 완료
- 🔴 **중대 발견 — SEARCH 키 8개 슬롯이 여전히 활성**: `YOUTUBE_API_KEY_SEARCH` + `_2`~`_8` (+ legacy `YOUTUBE_API_KEY`). **"7→1 통합"이 안 됨.** 마스터플랜 하드가드 "다중키 = ToS ban 리스크(전 계정 정지)"가 **현재 라이브**. W3 표적수집 전 **선결 리스크**. (코드: `src/skills/plugins/video-discover/v2/youtube-client.ts:169 resolveSearchApiKeys`, `MAX_SEARCH_KEY_SLOTS=10`.)
- **라이브 서빙 쿼타** (`quota_usage`): **24 units/day** (limit 10,000 = **0.24%**). 헤드룸 ~9,976/day 거대.
  - ⚠️ **측정 caveat**: `quota_usage`/`quota_operations`는 **playlist-sync 경로만** 추적 (7일: playlist.items 140 + video.details 28). **위저드 search.list(100 units/회)는 이 테이블에 안 흐름 → 라이브 서빙 실소비는 undercount.** 진짜 위저드 쿼타는 별도 trace 필요(다음 세션 정밀화 대상).
- **공급 쿼타** (`video_pool_collection_runs.quota_used`): **최근 14일 0 runs** → batch-collector cron **OFF** (CP496 "40k cron-off" 확증).
- **결론**: 단일 프로젝트 헤드룸 충분 → W3 표적수집은 단일 컴플라이언트 키로 가능. 8-key는 쿼타 때문이 아니라 **ban 리스크** 때문에 1개로 통합해야 함.
- 쿼타 테이블 정정: 핸드오프 `collection_runs` → 실제 `video_pool_collection_runs`. 라이브=`quota_usage`(id,date,used,quota_limit) + `quota_operations`(operation_type,cost).

---

## 3. 코드 앵커 (지평 1 착수 시 필수 — 이미 검증됨)

- **pool-serve 소스 하드코딩**: `src/modules/queue/handlers/pool-serve-fill.ts:257-262` `tsvectorKeywordCandidatesPerCell(..., ['v2_promoted'])`. 게이트 `:246` `gatePct >= cfg.relevanceMin(60)`. deficit=per-cell(`cfg.minPerCell=3 − placed`), `:503-522` `dispatchPoolServeForMandala` = deficit>0 셀만 발화(전 셀 ≥3이면 침묵 no-fire, RC1 = 8.2%에 불과 = 지배원인 아님, 반증됨).
- **v3 hybrid-rerank 소스 기본값**: `src/skills/plugins/video-discover/v3/hybrid-rerank.ts:156-220` `tsvectorKeywordCandidates` source 기본 `['v2_promoted']` (의도적 anti-noise, 토익스피킹 사고 주석). `WHERE vp.is_active=true AND vp.source=ANY(...) AND vp.quality_tier IN ('gold','silver')`.
- **셀 임베딩**: `mandala_embeddings` 테이블 (M2용).
- **SEARCH 키 resolve**: `src/skills/plugins/video-discover/v2/youtube-client.ts:169`.
- video_pool 컬럼: `source(v2_promoted/yt_promoted/batch_trend/user_curated)`, `quality_tier(gold/silver/bronze)`, `is_active`, `expires_at`(수집시각 기준 TTL, 기본 30d), `published_at`, 임베딩=`video_pool_embeddings`(pgvector ivfflat cosine lists=12, qwen3 4096-dim).

---

## 4. 반증된 가설 (measure-first 규율 — 반복 금지)

1. ❌ "RC1(침묵 no-fire)이 <50 지배원인" → STEP 0: 8.2%뿐. 빈 셀 71%/94% 구 만다라가 지배.
2. ❌ "소스 확대 = 무료 upside" → v2_promoted 제한은 의도적 anti-noise(토익스피킹).
3. ❌ "~11.4k 회수 가능" → M1: 임베딩된 건 4,460뿐(활성 gold/silver 7,022 미임베딩).
4. ❌ "7→1 통합 완료됨" → M4: 8-key 여전히 활성(ban 리스크 라이브).
5. ❌ (prod 느림) event-loop/MTU/stuck-worker 가설 3종 → 측정으로 전부 반증. 진짜 원인 = MCP debugger CDP attach + ssh 별칭 버그.

---

## 5. 불변 가드 (절대 — 위반 시 트랙 붕괴)

- **Typesense = 완전 분리 별도 리포. insighta와 교차 절대 금지.**
- **100k 확장 / 다중키 쿼타 분산 = 금지** (ToS ban = 전 계정 정지). 표적 수집도 단일 컴플라이언트 예산.
- **prod 직접 조작 금지** (systemctl/docker restart/Security Group 변경). ← CP506 prod daemon restart "범죄" 사고.
- **"≥50 관련, 아니면 honest-partial"** — 쓰레기로 채운 50 = 실패. 관련은 **gc 분포**로 증명(개수 아님).
- **center-goal = LLM 쿼리** (CP492 원칙, raw concat 금지). 위저드 8쿼리에 중심 키워드 단독 미발행 문제 = 함께 고려(James 지적).
- **gc 하한 60→55까지만**, 그 이하 금지.
- 모든 개입 **flag-gated · unset=no-op · config-flip 우선 · 지표+롤백 명시**.
- **Done = James prod 실측 + CC 자기검증** (CI green·DB count ≠ Done). 표가 질문에 답 못하면 재측정.
- 측정 = 전부 read-only SELECT. 쓰기·배포·서빙로직 변경 0 (지평 0 동안).

---

## 6. 다음 세션 즉시 할 일 (우선순위)

1. **M2 커버리지 갭 맵 완주** (지평 0 마지막 조각) — `mandala_embeddings` 셀 임베딩 vs 회수풀(4,460) cosine 매칭, 코어 만다라 셀별 후보 수 → 갭 셀/도메인 목록. read-only.
2. **M4 위저드 쿼타 정밀화** — search.list 실소비 trace (quota_usage undercount 보정). 위저드 create 3-endpoint 경로에서 실제 units.
3. **지평 0 종합표 → James trace 확인** → 지평 1 스코프 확정.
4. 이후 **지평 1**: W1 수율회수(소스확대 flag + 임베딩백필 RunPod + untiered 재채점 + TTL 발행일기준 수정 + 115 구빈셀 백필 dry→소수→전체) / W2 서빙품질(reconciler + 채널 하드캡 + recency tiebreak volatility-aware + center-goal LLM쿼리 + view-floor + adapter passthrough) / W3 표적수집(M2 갭만, 단일 키, 며칠 분산).

---

## 7. 진행 중이던 기타 컨텍스트 (누락 방지)

- **현재 브랜치**: `feat/v2-translations` (검색품질 트랙과 별개. CP500 carryover = v2 번역 PR 트랙, 커밋 `a6957f62`, .branch-wip.json 등록). 검색품질 작업은 read-only 측정이라 브랜치 무관하게 진행 중.
- **최근 세션(CP506 근처) 병행 작업들** (검색품질 트랙 외, 대부분 완료/PR):
  - 노트 렌더 개선: figureCaption '표/차트/도식' 라벨 제거(insight||null), callout border 균일화, 사이드바 만다라 full-name+bullet, mermaid 색상(#1030 stripColorDirectives+theme:base), 이모지 strip(#1031), 노트 heading empty-text-node fix(#1021).
  - **이모지 사용 금지 룰 위반 사고** (James "싸구려 이모지로 품질 망침, 생각좀하자") — 인사이타 프로젝트 이모지 금지 재확인.
  - prod 느림 장애 saga: ssh 별칭 버그(MagicDNS→raw IP `100.91.173.17` 고정) + MCP debugger가 James 브라우저 저하 → NEW 룰 2개(`feedback_no_prod_daemon_restart.md`, `feedback_no_mcp_debugger_on_user_browser.md`).
  - `.d2-blocking` 마커 존재 (CP506 D2=0.45) — 다음 /init BLOCKING 대상.
- **백로그**: 노트 편집(md처럼 텍스트/수식 편집 가능해야, 영상·시각화오브젝트 제외) — 콜아웃 타입변경·슬래시커맨드 삽입 UI = 백로그 #1023. export heading-duplicate. generation-UX 재설계(note-after-v2/spinner/regen-on-add).

---

## 8. 실측 스크립트 (재현용, scratchpad)

- `scratchpad/m34b.js` — M4 키개수 + M3 코어만다라 신선도
- `scratchpad/m2.js` — 테이블 소스 탐색(mandala_embeddings/quota)
- `scratchpad/m4final.js` — M4 공급/라이브 쿼타
- 실행 패턴: `cat <script> | bash scripts/ssh-connect.sh "docker exec -i insighta-api node"` (prod DB, read-only). ssh-connect가 SG dance 자동 처리(출력에 SG revoke JSON 섞일 수 있음 — 무해).
