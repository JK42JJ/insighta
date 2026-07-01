# Insighta 검색 관측 · 평가 시스템 종합 설계 (SSOT)

> 2026-07 · 베타 선결 인프라. CC 구현 대상. 원칙: 상시(scheduled)·SSOT 스키마·추적가능·재현가능.
> 이 문서의 전제(3개월 교훈): 관측/평가 인프라가 없어 눈 감고 랭킹을 튜닝했다. 매 세션 일회성
> SELECT = 고고학. 해법은 또 하나의 랭킹 개선이 아니라 **평가가 상시 돌아가는 시스템.**

---

## 0. 왜 이 시스템 (베타 선결)
- 이번 사이클 발견(RC1 8.2%·빈셀 94%구·회수 11.4k→4,460·8키 라이브·TTL 67% 만료)은 전부 손으로 돌린 read-only SELECT로 나옴 = 상시 인프라였다면 수개월 전 노출.
- 베타에서 품질이 나빠도 **왜인지 볼 수 없으면** 시간·돈 낭비. 관측 없는 베타 = 무의미.
- 따라서 베타 전에 (1) 전체 flow trail log (2) 일일 품질 리포트(admin 메일) (3) 통합 대시보드 (4) 버전 비교용 평가 하네스가 있어야 한다.

---

## 1. 아키텍처 — 2층 + 1 하네스

| 층 | 무엇 | 목적 | 형태 |
|---|---|---|---|
| **A. Per-request Trace (Trail Log)** | 단일 요청(위저드/add-cards/pool-serve)의 전체 결정 트리 | **디버그** — "이 만다라 왜 쓰레기?" 한 건을 끝까지 추적 | trace_id별 구조화 이벤트 |
| **B. Aggregate Daily Metrics** | 전 요청/만다라의 하루 롤업(5축+풀+쿼타+퍼널) | **추세·회귀 탐지** — "어제 배포 후 품질 떨어졌나?" | 시계열 메트릭 + 일일 메일 |
| **하네스. Eval Harness** | 고정 골든 코호트에 동일 지표 반복 측정 + 버전 태깅 | **버전 비교/실험** — 눈 감은 튜닝 종식(그동안 없던 것) | 스케줄 + 온디맨드 |

A와 B는 **한 계측을 공유**한다 — 후보별 drop_reason을 남기면(A) 그걸 집계해 퍼널 attrition(B)이 나온다. 한 번 심고 둘 다 얻는다.

---

## 2. 계측할 파이프라인 (James의 flow를 그대로 매핑)
"사용자 목표 입력 → 쿼리가 YouTube로 → 어떤 영상 받음 → 어떻게 평가/폐기" = 아래 9단계. 각 단계가 trace 이벤트를 emit.

| 단계 | 무엇을 남기나 |
|---|---|
| 1. 목표→만다라 | mandala_id, cells, center_goal |
| 2. **쿼리 생성** | LLM이 생성한 검색 쿼리들(셀별 + center-goal 단독) — 무엇을 보냈나 |
| 3. **YouTube fanout** | search.list 쿼리·pageToken, raw 결과(video_id 목록), quota_units, 429/실패 쿼리 수 |
| 4. ingest/필터 | dedup·blocklist·shorts·off-lang·series-dedup에서 각 탈락 수·사유 |
| 5. 후보 풀 | live 후보 + pool-serve 후보(소스 tier별), 임베딩 유무 |
| 6. **관련도 평가** | 각 후보의 gc(LLM)·cosine 점수 |
| 7. **게이트 결정** | 각 후보 keep/drop + **drop 사유**(below_gc/shorts/view_floor/off_lang/series/channel_cap/slice_overflow/dup) |
| 8. 배치 | 셀 배정, cell deficit, pool-serve 발화/미발화, reconciler |
| 9. 최종 서빙 | 사용자에게 간 카드 목록 |

**핵심 산출 = "카드 여정(Card Journey)"**: 각 후보 영상에 대해 — 어디서 왔나(live 쿼리 X / 풀 소스 Y) · 무슨 점수(gc/cosine) · keep인가 drop인가(사유) · 최종 어느 셀. 이게 James가 말한 trail log의 본체.

---

## 3. Trace 스키마 (Trail Log — 시스템의 중심)

**`search_trace`** (요청당 1행)
```
trace_id, mandala_id, user_id, trigger(wizard|add_cards|pool_serve),
started_at, queries_generated(jsonb: 셀별+center 쿼리 텍스트),
quota_units, queries_succeeded, queries_failed(429 등),
counts(jsonb: raw / after_dedup / after_filters / scored / placed / dropped),
outcome(카드수, empty_cells, honest_partial 여부)
```

**`search_trace_candidate`** (요청 내 후보 영상당 1행)
```
trace_id, video_id, channel_id,
source(live:{query_text} | pool:{source_tier}),
stage_reached, relevance_gc, cosine,
decision(PLACED | DROPPED), drop_reason(enum), final_cell(level,index)
```

→ 이 둘로 임의 만다라에 대해 "보낸 쿼리 → YouTube가 준 N개 영상 → 각 점수 → keep/drop 사유 → 최종 셀"을 완전 재구성. 그리고 `drop_reason` 집계 = 퍼널 attrition(§4).

**계측 규율:** emit은 **비동기·fire-and-forget**(사용자 경로 지연 0). 베타 규모에선 저비용, 스케일 시 샘플링/보존 캡. PII·토큰 trace에 남기지 않음.

**quota_units = per-request 실소모의 SSOT**(모든 trigger). 지평 0에서 `quota_usage`(24/day)가 playlist-sync만 기록하는 undercount 아티팩트임이 확증됐고, add-cards 실소모는 ~731/run(피크 3,505/day)로 별개였다. 따라서 trace의 `quota_units`가 진짜 값이며, **특히 위저드 precompute 경로 units는 지평 0에서 미측정으로 남은 핵심 빈칸**이다 — 베타 주 진입점이라 "유저 N명 = 쿼타 얼마"(베타 캐파 상한 + 증설 projection의 핵심 계수)가 여기서 나온다. trace는 **위저드 precompute를 포함한 모든 라이브 경로의 units를 반드시 남긴다.**

---

## 4. Aggregate 일일 메트릭 (추세·회귀)
매일 스케줄 롤업 → **`search_metrics_daily`**(시계열, 버전/flag 스냅샷 태깅). 5축 = 마스터플랜 정의 그대로:

| 그룹 | 지표 |
|---|---|
| **충분성** | 만다라 카드수 P10/P50/P90, %>=50, %honest_partial |
| **관련성** | gc 중앙값·분포, %<65, 경계선(60~65) 비중 (tech/non-tech 분리) |
| **신선도** | %<=6mo (volatile vs evergreen 분리 — M3가 volatile 노후 심각 확인) |
| **다양성** | top-channel share, HHI |
| **정합** | %view<1000(display+placed), off-lang drop, 기술-ko starvation |
| **풀 건강(수율)** | 활성/임베딩/tiered 카운트, TTL만료 %, 회수가능 서빙풀 |
| **커버리지** | 코어 도메인 셀별 갭 수(M2 산출을 상시화) |
| **쿼타·컴플라이언스** | 일 units(공급 vs 라이브), **활성 SEARCH 키 개수** |
| **퍼널 attrition** | raw→dedup→filters→scored→gated→placed 단계별 감쇠(§3 drop_reason 집계) |

---

## 5. 일일 리포트 메일 (admin 발송 — James 핵심 요구)
- **스케줄**: 기존 스케줄러 재사용 — Temporal 아님(Phase 0 확증). 실제는 **pg-boss `boss.schedule` + node-cron**(등록 `queue/index.ts`, 일일 job 템플릿 `v2-quality-audit-cron.ts` / `server.ts` cron 훅). 매일 정시.
- **수신**: admin(James)만.
- **내용**: 오늘 5축+풀+쿼타 스냅샷 + **어제 대비 delta**(up/down) + **알람**(§8) + 하이라이트(가장 나빠진 지표 top-N + 대표 나쁜 만다라 trace 링크).
- **핵심**: 대시보드는 "가서 봐야" 하지만 메일은 **밀어준다** — 회귀를 놓치지 않는 게 상용의 조건. "어제 배포 후 gc 중앙값 -8, 8키 여전히 활성" 같은 한 줄이 매일 도착.
- 렌더: HTML 이메일(간결·다크). **이메일 인프라 = 존재**(`mailer.ts` 공유 transporter, nodemailer Gmail SMTP relay, EC2 IP-whitelisted) → 그대로 재사용(greenfield 아님). delta·알람은 색으로. 나쁜 케이스는 trace explorer 딥링크.

---

## 6. 대시보드 통합 (반쯤 만든 것들을 하나로)
현재 흩어진 것(/admin/pool-health, skill_runs, video_pool_collection_runs, quota_usage/quota_operations, dispatchPoolServe telemetry, add_cards trace, 각종 일회성 스크립트)을 **하나의 admin 관측 서피스**로 통합. 4 뷰:

1. **추세(Trend)** — `search_metrics_daily` 5축 시계열(회귀 한눈).
2. **Trace Explorer** — mandala_id/trace_id 입력 → §3 카드 여정 전체 flow 시각화(쿼리→raw→점수→keep/drop 사유→셀). **디버그 핵심 화면.**
3. **풀 건강** — 수율(활성/임베딩/tier)·TTL·커버리지 갭·신선도.
4. **쿼타·컴플라이언스** — units 배분 + 활성 키 개수 알람 + 공급 cron 상태.

규율: 기존 admin(AdminRoute) 확장, 코딩 컨벤션 준수(Tailwind + CSS 변수, 동적 클래스 금지·RING_STYLES 패턴). 새 스택 도입 없음(스케줄=pg-boss/node-cron, 메일=mailer.ts, 전부 기존 재사용). Typesense 무관.

---

## 7. Eval Harness (그동안 없던 것 — 버전 비교/실험의 핵심)
> 3개월 낭비의 직접 원인 = "검색엔진 각 버전 비교·품질 평가를 안 함." 이걸 상시 하네스로.

- **골든 코호트 고정 = M2가 이미 실측한 코어 만다라 셋과 동일**(영문법·코딩테스트·토익·K8s·ETF·AI 등, 5 ko + 5 en; tech-ko >=2, volatile >=2, evergreen >=2). 실험 doc의 추상 정의가 아니라 **M2 커버리지 갭을 이미 뽑아둔 그 만다라들**로 고정해야, 임베딩 백필 전후·버전 전후를 **기존 baseline이 있는 만다라로** 비교할 수 있다(코호트가 둘로 갈리면 baseline 재사용 불가). 버전 무관 동일 셋 유지.
- **반복 지표 = §4 그대로**를 이 코호트에만 계산 → 온디맨드 + 스케줄.
- **버전 태깅**: flag 조합·알고리즘 버전을 스냅샷에 기록 → 임의 변경(flag flip, 알고리즘 버전, 나중에 Typesense vs 현행)을 **동일 코호트 before/after**로 비교.
- **재사용**: 지평 0의 M1~M4 SELECT를 일회성으로 버리지 말고 이 하네스의 쿼리로 승격 — 이미 짠 걸 상시화.
- → 앞으로 어떤 개입도 "느낌"이 아니라 골든 코호트 delta로 판정. 눈 감은 튜닝 종식.

---

## 8. 알람 & 게이트 (선제 — 대시보드 안 봐도 뜸)
| 알람 | 조건(예시) |
|---|---|
| **다중키 ban 리스크** | 활성 SEARCH 키 > 1 (현재 8 = 상시 발화) |
| 품질 회귀 | gc 중앙값 or P10 카드수 전일 대비 임계 하락 |
| 쿼타 임박 | 일 units가 단일 프로젝트 한도 근접 |
| 풀 수율 저하 | 활성/임베딩 비율·회수풀 하락 |
| 커버리지 갭 | 활성(사용중) 도메인이 갭 상태로 진입 |
| 공급 정지 | batch-collector cron OFF(현재 14일 0 runs) |

알람은 일일 메일 상단 + 대시보드 배너. (배포 직후 회귀를 그날 잡는 게 목적.)

---

## 9. CC 실행 단계 (measure-first — 현황 확인부터)

**Phase 0 · 인벤토리 (read-only, 빌드 0) — 완료 2026-07-01**
현존 계측 전수 감사. 산출 = `docs/handoffs/observability-phase0-inventory-2026-07-01.md`. 확정: 리치 계측(cosine·cohere·쿼리생성 prompt)은 전부 폐기 v3 경로, 라이브 v5는 최소 집계뿐. per-candidate 원장 전무 → search_trace_candidate 신설. 위저드 precompute units = 2 JSON 위치 계수급 갭. Trace Explorer 전무. 스케줄=pg-boss/node-cron(Temporal 아님). 이메일=mailer.ts 존재.

**Phase 1 · Trace Spine (베타 크리티컬)**
§3 스키마 + 9단계 emit(비동기). 카드 여정부터(James 최우선). Trace Explorer 최소 화면.
**Phase 0 확정**: 리치 계측은 폐기 v3 경로, 라이브 v5는 최소 집계 → "v3 계측 재사용"은 경로가 달라 대부분 **불가**. Phase 1 본질 = **v5 라이브 경로(executor/llm-picker/youtube-fanout)에 신규 emission**(flag on이 아님 — V3_TRACE_ENABLED=true라 spine은 이미 켜져 있으나 per-candidate/picker/query-gen 미emit). `search_trace`=대체로 확장(1·3·9), `search_trace_candidate`=전면 신설(2·4·5·6·7·8). quota_units는 위저드 precompute 포함 전 트리거 SSOT로 통일(현재 키명 불일치·MISS 소실·pool-serve 라이브 units 전무).
**gc/cosine = nullable, 서빙 경로에 relevance 스코어러 추가 금지(read-path 무변경). v5 trail log의 "왜 drop"은 drop_reason으로. gc 분포는 골든코호트 오프라인 평가(§7)에서.**

**Phase 2 · Aggregate + 일일 메일 (베타 크리티컬)**
§4 롤업 job + §5 admin 메일(delta+알람). §8 알람 발화.

**Phase 3 · Eval Harness**
§7 골든 코호트 + 반복 지표 + 버전 태깅(지평 0 SELECT 승격).

**Phase 4 · 대시보드 통합/폴리시**
§6 4뷰 통합·정리.

> 베타 게이트 = Phase 1(trace) + Phase 2(일일 메일·알람) 라이브. Phase 3(하네스)는 검색품질 fix 검증에 필요하니 사실상 병행. Phase 4는 점진.

---

## 10. 가드레일
- **관측자 효과/비용**: trace emit 비동기·사용자 경로 지연 0. 베타 저비용, 스케일 시 샘플링·보존 캡.
- **read-path 안전**: 계측이 서빙 로직/결정 바꾸지 않음(관측만). 서빙 경로에 relevance 스코어러(LLM) 추가 금지.
- **admin-only + PII 금지**: 메일·trace는 admin 전용, 토큰·개인정보 미포함.
- **SSOT 스키마**: 흩어진 테이블 난립 금지 — search_trace / search_trace_candidate / search_metrics_daily로 수렴, 기존 부분 계측은 이리로 마이그레이션.
- **기존 스택**: 스케줄=pg-boss `boss.schedule`/node-cron(Temporal 아님, Phase 0 확증)·메일=mailer.ts(nodemailer)·대시보드=AdminRoute·Supabase 재사용. 새 인프라·Typesense 무관.
- **완료 = 실측**: 각 Phase Done = CC 자기검증(trace가 실제 한 요청을 재구성하나 / 메일이 실제 발송되나 / 골든 코호트 delta가 나오나). 구현/CI ≠ Done.

---

## 11. 이 시스템이 상용인 이유 (한 줄)
평가가 **상시 자동으로** 돌고(스케줄+메일), 전 flow가 **한 건까지 추적**되며(trail log), 모든 변경이 **골든 코호트로 측정**된다(하네스) — 매 세션 손으로 파던 고고학이 인프라가 된다. 베타에서 뭐가 나빠도 **왜인지 즉시 보인다.**
