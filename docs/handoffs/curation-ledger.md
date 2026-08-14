# C-원장 — 큐레이션 누적 변수 원장

> 범위: 주간 편성, 구독, 덱. **PC 에 없는 개념이라 T 축과 분리한다** (James 2026-08-04).
> 정책: `docs/LEDGERS.md`. 파라미터 상세: `docs/PERFORMANCE_PARAMETERS.md`.
> **최신 번호: C2**

---

## C1 — 현재 상태 기준선 (소급 등재, 2026-08-04 실측)

배포 시점이 아니라 **관측 시점** 기준으로 기록한 기준선. C2 이후를 이것과 비교한다.

### 로직

주간 빌드(`curation-build.ts`)가 두 레그를 순서대로 쓴다.

1. **신선 레그** — `weekly-fresh.ts` → `runV5Executor` 라이브 검색. 7일 창, 결과가 **0일 때만** 30일로 확대. 통과분에 `computeCardRelevance ≥ 40` 적합도 게이트, **판정 실패 시 fail-open**(floor 값으로 통과).
2. **풀 사다리** — 남은 칸을 `matchFromVideoPoolByCenterGoal` 코사인 매칭으로. 4단 사다리 `0.5 → 0.5 → 0.35 → 0.35`, 마지막 단은 4주 전 서빙분 재유입 허용. **적합도 판정 없음.**

### 파라미터

| 이름 | 위치 | 값 |
|---|---|---|
| `CURATION_RELEVANCE_FLOOR` | `modules/curation/config.ts:62` | 40 |
| `CURATION_FRESH_WINDOW_DAYS` | `weekly-fresh.ts:54` | 7 |
| `CURATION_FRESH_RETRY_DAYS` | `weekly-fresh.ts:55` | 30 |
| `CURATION_PICK_RUNGS` | `config.ts:85` | threshold 0.5/0.5/0.35/0.35, exclusionWeeks null/null/null/4 |
| `CURATION_SCHED_KST_ENABLED` | compose | true |
| `CURATION_CHANNEL_SOURCE_ENABLED` | compose | true |
| `MIN_DURATION_SEC` / `MAX_DURATION_SEC` | batch-collector manifest | 60 / 3600 |

### 측정 (활성 파이썬 구독 `bb94d4d3`, week_of 2026-08-03)

```
curation fresh leg  topic=파이썬  windowDays=30  searched=4  fitDropped=3  picks=1
curation build      buildMode=weekly  picked=17  weeklyNoveltyPct=100
```

- 17편 중 **9편이 주제 무관** — 스페인어 회화 3, 메이크업 국가자격증, 기타 코드, lofi 플레이리스트, 다른그림찾기, 잡학상식.
- 파이썬으로 볼 수 있는 3편은 **각각 6~9년 전** 영상.
- 소스: `v2_promoted` 16 / `curation_weekly` 1. **신선 레그 기여 1/17.**
- `relevance_pct` 46~35 — 풀 픽은 **코사인 × 100** 이 저장된다(`curation-build.ts:285`). 신선 레그는 LLM 적합도 점수를 저장한다. **한 컬럼에 두 척도가 섞여 같이 정렬된다.**
- `weeklyNoveltyPct=100` — 지난주와 겹치는 항목 0. 신규성은 만족하나 **적합성은 아무도 측정하지 않았다.**

### 부수 관측

- 이 계정 구독 20개 중 **파이썬 12개**(활성 1 + 비활성 11), 호흡법 4개. 비활성 구독도 `last_run_at` 이 갱신돼 있다 — 스케줄러가 비활성을 도는지 미확인.
- `curation_items.bookmarked_at` 컬럼은 존재하나 **리포 전체에서 읽는 곳도 쓰는 곳도 없다**(스키마·마이그레이션 SQL 제외).

### 비용

주제당 주 1회 빌드 = v5 라이브 검색 8 쿼리 × 100 유닛 = **800 유닛** + LLM 적합도 판정(신선 후보 한정, 최대 `limit×2`).

### 롤백

기준선이므로 해당 없음.

---

## C2 — 주제 shaping (2026-08-04, 배포됨 · 소급 등재)

PR **#1459**(코드) + **#1462**(prod 플래그 on). **두 PR 모두 번호 없이 통과** — 가드 스코프에 큐레이션이 없었다. 이 항목이 그 소급 등재다.

### 무엇을 바꿨나

주제 한 단어에 접미사를 붙여 만든 라벨 4개(`파이썬` / `파이썬 최신` / `파이썬 강의` / `파이썬 사례`)를 v5 에 넘기던 것을, `generateMandalaWithQueries`(위저드의 기존 부품)로 **진짜 하위주제 8개 + 셀 쿼리 8개**를 만들어 넘기도록 바꿨다. v5 는 `precomputedQueries` 로 이미 받을 수 있었고(CP493), 큐레이션만 배선이 없었다.

**동기**: 거의 같은 라벨 4개를 받으면 쿼리 생성기가 차이를 발명해야 하고, `<주제> 사례` 가 성공담 쪽으로 흘렀다. C1 측정의 자기계발 채널(라이프해커·자청 / 유튜브신쌤 / 지투지)이 그 결과다.

### 파라미터

| 이름 | Default | Prod | 위치 |
|---|---|---|---|
| `CURATION_TOPIC_SHAPING_ENABLED` | false | **true ★** | `src/config/index.ts` · `docker-compose.prod.yml` |

플래그는 **호출 자체를 게이트**한다 — off 면 생성기를 부르지 않는다.

### 측정 (같은 구독 재빌드, 2026-08-04 04:41)

```
curation topic shaping  degraded=false  queryCount=8  latencyMs=5414
  subGoals: 파이썬 기초 문법과 데이터 타입 학습 / 함수와 모듈을 활용한 코드 구조화 /
            파이썬으로 웹 크롤링 및 자동화 구현 / 판다스와 넘파이를 이용한 데이터 분석 /
            장고 또는 플라스크로 웹 애플리케이션 개발 / 머신러닝과 사이킷런 기초 이해 /
            파이썬 디버깅과 예외 처리 능력 / 실무 프로젝트로 파이썬 포트폴리오 구축
fresh: { picks: 0, fitDropped: 1, windowDays: 7 }
picked: 16   ← 전부 풀 사다리
```

**쿼리 품질은 고쳐졌고 편성은 안 고쳐졌다.** 하위주제 8개 전부 진짜 파이썬, 커버리지 8/8, degraded 없음. 그런데 신선 픽은 1 → **0**.

이 음성 결과가 이 항목의 가장 큰 값이다 — **쿼리가 병목이 아니었음을 증명**했고, 진단을 풀 유입(P 축)으로 옮겼다.

### 드러난 잠복 버그

`windowDays` 가 **7 로 머물렀다.** 확대 조건이 이렇다:

```js
if (!v5.cards.length) { windowDays = 30; v5 = await runSearch(30); }
```

**검색 결과가 0일 때만** 넓힌다. 쿼리가 좋아지자 7일 창에서 후보 1편이 잡혔고, 그 1편이 적합도에서 떨어졌는데도 **30일 확대가 봉쇄됐다.** 개선이 잠복 버그를 깨웠다. 수정 = `picks < 목표` 조건으로 (C3 예정).

### 비용

주제당 빌드 1회에 `generateMandalaWithQueries` **OpenRouter 호출 1회 (실측 5,414ms)**. 7일/30일 재시도 위로 hoist 되어 재시도가 두 번 물지 않는다.

### 롤백

`docker-compose.prod.yml` 에서 `CURATION_TOPIC_SHAPING_ENABLED` 줄 삭제 → 배포. 코드는 접미사 라벨로 fail-open 하므로 revert 불요. 데이터 잔재 없음.

### 관측

배포 직후 1회 재빌드만 관측. **정기 주간 사이클 미관측.**

---

## C3 — (예정) 게이트 단일 길목 + 확대 조건 수리

James 결정(2026-08-04): **쓰레기 유입 불가. 좋은 것을 잃더라도 무관한 영상은 허용하지 않는다.**

이 결정은 `config.ts:72` 의 반대 원칙(*"NO rung combination may end at an empty week"*)을 폐기한다. 설계: `docs/handoffs/curation-topic-pool-design-2026-08-04.md` §6.

착수 전이므로 파라미터·비용·측정은 미확정.
