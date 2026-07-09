# Insighta 성능 파라미터 종합 (SSOT)

> **목적**: 카드검색·풀·위저드·만다라·임베딩의 모든 성능 파라미터/옵션/룰을 한 곳에.
> 성능 개선 시 이 표를 보고 무엇을 바꾸면 무엇이 영향받는지 판단하고, 변경 후 테스트 범위를 정한다.
> **admin 파라미터 관리 기능의 데이터 모델 근거**로 사용.
>
> **작성**: 2026-07-09 (CP512). 코드 실측 + prod printenv 기준.
> **컬럼 의미**: `Default`=코드 기본값 / `Prod`=현재 prod 실제값(다르면 ★) / `범위`=허용 min-max / `영향`=바꾸면 무엇이 달라지나.
> **갱신 규칙**: 파라미터 추가/변경 PR은 이 표도 같은 PR에서 갱신. prod 값 변경 시 `Prod` 열 갱신.

---

## 0. 한눈에 — Prod가 Default와 다른 것 (★ = 주의)

| 파라미터 | Default | **Prod** | 왜 다른가 |
|---|---|---|---|
| V3_CENTER_GATE_MODE | substring | **semantic** ★ | 임베딩 기반 center gate 활성 (관련도↑, 임베딩 의존) |
| V3_SEMANTIC_MIN_COSINE | 0.35 | **0.5** ★ | 관련도 하한 상향(엄격) |
| V3_ENABLE_TIER1_CACHE | false | **true** ★ | video_pool 캐시 서빙 ON |
| V3_TIER1_SOURCES | v2_promoted | **v2_promoted,yt_promoted** ★ | 공급 소스 확대 |
| V3_RECENCY_WEIGHT | 0.15 | **0.05** ★ | 최신성 가중 완화 |
| V3_ENABLE_QUALITY_GATE | false | **true** ★ | 품질 게이트 ON |
| V3_ENABLE_HYBRID_RERANK | (n/a) | **true** ★ | Cohere rerank ON |
| V5_PICKER_MODE | llm | **cell_binning** ★ | LLM 픽 대신 셀 비닝(비용↓) |
| V5_QUERY_GEN | rule | **llm** ★ | 쿼리 생성 LLM |
| V5_SEARCH_MAX_RESULTS | 25 | **40** ★ | search.list 후보/콜 |
| V5_TARGET_PICKS | 30 | **60** ★ | 셀당 목표 카드 |
| V5_DEDUP_HARDCAP | 120 | **180** ★ | dedup 상한 |
| V5_POOL_BACKFILL | false | **<unset>=false** | pool-first OFF (베타 후 검토) |
| V5_REUSE_LOOP | false | **<unset>=false** | live→pool 축적 OFF (베타 후) |
| EMBED_ASYNC_SERVE | true | **<unset>=true** | 임베딩 비동기 서빙(CP512) |

---

## 1. 카드 발굴 — YouTube search.list (쿼터 핵심)

| 파라미터 | 위치 | Default | Prod | 범위 | 영향 |
|---|---|---|---|---|---|
| **search.list units/콜** | youtube-client.ts:317 | 100 (고정) | 100 | — | YouTube 과금. 1콜=100 units. 일 한도 10,000 = 100콜/일. |
| **search.list 키** | youtube-client.ts:169 `resolveSearchApiKeys` | 단일키(CP512) | YOUTUBE_API_KEY_SEARCH 1개 | — | ★ToS: 다중키 로테이션 금지(CP512 제거). 쿼터 우회 위반. |
| V5_SEARCH_MAX_RESULTS | v5/config.ts:25 | 25 | **40** | 10-50 | 콜당 후보 수. ↑=같은 100units에 더 많은 후보(add-cards 재검색 지연). 상한 50(YouTube). |
| V5_MAX_QUERIES | v5/config.ts:23 | 8 | 8 | 1-20 | 만다라당 search.list 콜 수(셀당 1). ×100 = units/만다라. |
| V5_SEARCH_TIMEOUT_MS | v5/config.ts:24 | 2000 | 2000 | 500-8000 | fanout 콜 타임아웃. |
| V3_YOUTUBE_SEARCH_TIMEOUT_MS | v3 env | 3000 | 3000 | — | v3 search.list 타임아웃. |
| BATCH_COLLECTOR_SEARCH_MAX_RESULTS | batch/manifest.ts:39 | 30 | 30 | — | 트렌드 수집 search.list 후보 수. |

## 2. 풀 우선 조회 (pool-first, quota-free) — **베타 후 검토**

| 파라미터 | 위치 | Default | Prod | 범위 | 영향 |
|---|---|---|---|---|---|
| V5_POOL_BACKFILL | v5/config.ts:52 | false | **OFF** | bool | ★풀 우선 게이트. ON=pool 충족 셀 live drop→쿼터 절감. 관련도 미검증 리스크. |
| V5_POOL_MATCH | v5/config.ts:86 | global | global | global\|per_cell | 셀별 vs 전역 tsvector 매칭. |
| V5_POOL_MIN_PER_CELL | v5/config.ts:59 | 3 | 3 | 1-20 | 셀 충족 기준(≥N이면 live skip). ↑=더 엄격(live 더 침). |
| V5_POOL_TIMEOUT_MS | v5/config.ts:62 | 1500 | 1500 | 200-5000 | pool tsvector 타임아웃. 초과→full live fallback(안전). |
| V5_POOL_SOURCE | v5/config.ts:56 | v2_promoted | v2_promoted | v2_promoted\|all | pool 조회 소스 필터. |
| V5_POOL_SERVE | v5 env | (n/a) | **true** | bool | pool 서빙 경로 활성. |
| V5_REUSE_LOOP | v5/config.ts:67 | false | **OFF** | bool | live 픽 결과를 pool 적재(source=user_live). ON=후반 pool 적중↑. |
| **pool tsvector 관련도 하한** | hybrid-rerank.ts:403-415 | 없음 | 없음 | — | ★어휘 매칭+tier(gold/silver)만. cosine 절대하한 無 = 니치서 트렌드 잔여물 서빙 리스크. |

## 3. 위저드/add-cards 픽 (v5)

| 파라미터 | 위치 | Default | Prod | 범위 | 영향 |
|---|---|---|---|---|---|
| V5_PICKER_MODE | v5/config.ts:38 | llm | **cell_binning** | llm\|cell_binning | LLM 픽(비용) vs 셀 비닝(무비용). |
| V5_QUERY_GEN | v5/config.ts:46 | rule | **llm** | rule\|llm | 쿼리 생성 방식(LLM=Haiku 콜). |
| V5_TARGET_PICKS | v5/config.ts:26 | 30 | **60** | 10-60 | 만다라당 목표 카드 수. |
| V5_DEDUP_HARDCAP | v5/config.ts:27 | 120 | **180** | 40-400 | LLM 픽 전 raw 상한. |
| V5_CELL_SKIP | v5/config.ts:72 | false | **true** | bool | 이미 채운 셀 검색 스킵(쿼터 절감). |
| V5_CELL_SKIP_THRESHOLD | v5/config.ts:79 | 12 | 12 | 1-60 | 셀 "full" 기준 카드 수. |
| V5_CHANNEL_HARD_CAP | v5 env | (n/a) | **3** | — | 채널당 최대 카드(다양성). |
| V5_DIVERSITY_GUARD | v5 env | (n/a) | **true** | bool | 시리즈-에피소드 dedup + 채널 소프트캡. |
| V5_KO_EN_TITLE_DROP | v5/config.ts:76 | true | **true** | bool | ko 만다라서 영어 우세 제목 드롭. |
| V5_LIVE_VIEW_FLOOR | v5 env | (n/a) | **0** | — | live 후보 조회수 하한. |
| V5_SHORT_OVERPICK_FACTOR | v5/config.ts:30 | 1.5 | 1.5 | 1-3 | Shorts 필터 대비 과다픽 배수. |
| V5_SHORT_PROBE_DEADLINE_MS | v5/config.ts:33 | 8000 | 8000 | 0-15000 | Shorts 판별 타임아웃. |

## 4. v3 서빙 게이트/관련도

| 파라미터 | 위치 | Default | Prod | 범위 | 영향 |
|---|---|---|---|---|---|
| VIDEO_DISCOVER_V3 | pipeline-runner.ts:42 | (분기) | **1** | 0\|1 | v3 파이프라인 활성. |
| V3_CENTER_GATE_MODE | v3/config.ts:69 | substring | **semantic** | substring\|subword\|off\|semantic | center gate 방식. semantic=임베딩 코사인, substring=제목 토큰. ★임베딩 의존. |
| V3_SEMANTIC_MIN_COSINE | v3/config.ts:260 | 0.35 | **0.5** | 0-1 | semantic center gate 통과 하한. ↑=엄격(카드↓ 관련도↑). |
| SEMANTIC_MIN_CELL_COSINE | mandala-filter.ts:56 | 0.25 (고정) | 0.25 | — | 셀 배정 코사인 하한. |
| V3_ENABLE_TIER1_CACHE | v3/config.ts:289 | false | **true** | bool | video_pool 캐시 Tier1 서빙. |
| V3_TIER1_SOURCES | v3 env | v2_promoted | **v2_promoted,yt_promoted** | — | Tier1 pool 소스. |
| V3_TIER2_OVERFETCH | v3/config.ts:308 | true | true | bool | Tier2 항상 실행 + 과다fetch. |
| V3_RECENCY_WEIGHT | mandala-filter.ts:71 | 0.15 | **0.05** | 0-1 | rec_score 최신성 가중. |
| V3_RECENCY_HALF_LIFE_MONTHS | mandala-filter.ts:74 | 18 | 18 | — | 최신성 반감기(개월). |
| V3_ENABLE_QUALITY_GATE | v3/config.ts:300 | false | **true** | bool | 품질 게이트. |
| V3_ENABLE_HYBRID_RERANK | v3 env | (n/a) | **true** | bool | Cohere rerank(cost). |
| V3_ENABLE_SEMANTIC_RERANK | v3/config.ts:293 | false | false | bool | 시맨틱 rerank. |
| V3_ENABLE_SIGNAL_EXCLUDE | v3/config.ts:312 | true | true | bool | archive/delete 신호 제외. |
| V3_ENABLE_ZERO_HIT_RETRY | v3/config.ts:313 | true | true | bool | 0-hit 재시도. |
| V3_MIN_VIEWS_PER_DAY | v3 env | (n/a) | **33** | — | 조회수/일 하한. |
| V3_SEMANTIC_MAX_CANDIDATES | v3 env | (n/a) | **100** | — | semantic gate 후보 캡. |
| V3_EMPTY_TITLE_GATE | v3 env | (n/a) | **on** | — | 빈제목 게이트. |
| **rec_score 가중** | executor.ts:1543 | iks 0.25 / videoQuality 0.35 / freshness 0.20 / perMandala 0.10 / historical 0.10 | 동일 | — | ★서빙 순위 공식. videoQuality(조회수)=최대 가중. |
| V3_TARGET_PER_CELL | manifest.ts:33 | 12 (고정) | 12 | — | 셀당 목표 카드. |
| V3_NUM_CELLS | manifest.ts:34 | 8 (고정) | 8 | — | 만다라 셀 수. |

## 5. 만다라 생성 / 임베딩 (CP512 핵심)

| 파라미터 | 위치 | Default | Prod | 범위 | 영향 |
|---|---|---|---|---|---|
| **EMBED_ASYNC_SERVE** | config/index.ts | true | **true** | bool | ★CP512. 임베딩 실패/지연해도 카드 서빙(degraded lexical). false=레거시 하드게이트(임베딩 필수). |
| EMBEDDING_TIMEOUT_MS (상위) | pipeline-runner.ts:146 | 30_000 (고정) | 30_000 | — | ★임베딩 step 상위 타임아웃. 내부 fallback(20s+retry)보다 짧아 fallback 자름(감독 지적, 베타 후 수정). |
| EMBED_TIMEOUT_MS (Ollama) | embedding.ts:47 | 20000 (고정) | 20000 | — | Ollama 임베딩 콜 타임아웃. |
| OPENROUTER_EMBED_MAX_RETRIES | embedding.ts:57 | 2 (고정) | 2 | — | OpenRouter fallback 재시도. |
| DEFAULT_EMBED_CHUNK_SIZE | embedding.ts:64 | 50 (고정) | 50 | — | 임베딩 배치 chunk 크기. |
| IKS_EMBED_PROVIDER | config/index.ts:194 | ollama | **openrouter** | ollama\|openrouter | 임베딩 provider. openrouter=fallback 활성. |
| MANDALA_EMBED_MODEL | config/index.ts:64 | qwen3-embedding:8b | qwen3-embedding:8b | — | 임베딩 모델(4096d). |
| MANDALA_GEN_TIMEOUT_MS | generator.ts:63 | 600_000 (고정) | 600_000 | — | 만다라 생성 LLM 타임아웃(10분). |
| MANDALA_GEN_MODEL | config/index.ts:63 | mandala-gen | (Haiku 전환됨) | — | 만다라 구조 생성 모델. |
| MANDALA_GEN_URL | config/index.ts:62 | localhost:11434 | Mac Mini | — | 임베딩/gen Ollama URL(100.91.173.17). |

## 6. 품질 등급 (batch-collector + pool)

| 파라미터 | 위치 | 값 | 영향 |
|---|---|---|---|
| QUALITY_GOLD_VIEW_COUNT | batch/manifest.ts:51 | 100,000 | gold tier 조회수 하한. |
| QUALITY_SILVER_VIEW_COUNT | batch/manifest.ts:52 | 10,000 | silver tier. |
| QUALITY_BRONZE_VIEW_COUNT | batch/manifest.ts:53 | 1,000 | bronze tier(pool 서빙 최소). |
| MIN_DURATION_SEC | batch/manifest.ts:56 | 60 | 최소 길이(Shorts 배제). |
| MAX_DURATION_SEC | batch/manifest.ts:57 | 3600 | 최대 길이(1시간). |
| pool 서빙 tier 필터 | hybrid-rerank.ts:409 | gold, silver | pool 후보는 gold/silver만(bronze 제외). |

## 7. 풀 위생 / ToS (CP512)

| 파라미터 | 위치 | Default | Prod | 영향 |
|---|---|---|---|---|
| POOL_MAINTENANCE_ENABLED | config/index.ts:232 | true | true | 풀 유지보수 잡(expire+scrub). |
| POOL_METADATA_REFRESH_ENABLED | config/index.ts:239 | true | true | ★CP512. active 행 videos.list 갱신(ToS 준수). |
| METADATA_TTL_DAYS | pool-maintenance.ts:38 | 30 (고정) | 30 | YouTube ToS 메타 갱신/삭제 주기. |
| REFRESH_AFTER_DAYS | refresh-metadata.ts | 20 (고정) | 20 | 30일 전 갱신(10일 마진). |
| REFRESH_BATCH_LIMIT | refresh-metadata.ts | 500 (고정) | 500 | 갱신 배치/run. |
| SUPPLY_YT_BRIDGE_ENABLED | config/index.ts | (n/a) | **true** | youtube_videos→video_pool 승격. |

## 8. 변경 시 테스트 범위 매트릭스 (성능 개선 시 참조)

| 바꾸는 것 | 반드시 테스트할 것 |
|---|---|
| search.list 관련(units/키/maxResults) | 위저드 카드 수 + 쿼터 소모(Console) + add-cards 반복 |
| pool-first(POOL_BACKFILL/MIN_PER_CELL) | poolOnlyCells/liveCells 비율 + **pool 카드 품질 육안**(niche 시험대) |
| center gate/cosine(SEMANTIC_MIN) | 카드 수 vs 관련도 tradeoff + 니치 만다라 |
| recency weight | 최신 vs 관련 순위 변화 |
| 임베딩(ASYNC_SERVE/timeout) | ★Ollama 중단 상태 카드 나오나 + 정상 시 결과 불변 |
| 품질 tier(VIEW_COUNT) | pool 재고 규모 + 서빙 후보 수 |
| picker(PICKER_MODE/QUERY_GEN) | 픽 품질 + LLM 비용 |

## 9. admin 파라미터 관리 기능 설계 근거
- 이 표의 각 행 = admin UI의 편집 가능 파라미터 1개.
- **편집 위험도 3등급**: (a) env flag(재배포 없이 runtime_config로 hot-swap 가능 후보) / (b) 코드 상수(고정, PR 필요) / (c) 서빙 공식(rec_score 가중 — 신중).
- **Prod≠Default 행(§0)** = 이미 튜닝된 것 = admin 기본 노출 우선순위.
- 변경 이력 + A/B 근거를 남기도록 = 성능 개선의 감사 추적.
