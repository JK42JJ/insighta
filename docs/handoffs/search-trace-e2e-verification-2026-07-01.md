# 관측 Phase 1 STEP 3 — add-cards trail log 라이브 e2e 검증 (A)

> 이 문서 = 관측 시스템의 **첫 "진짜 Done" 게이트**. STEP 1~3 GREEN은 전부 CC-side 증명
> (코드 read + 단위테스트 4/4 PASS + 로컬 DB 라운드트립 PASS)이라 우리 원칙상 아직 Done 아님.
> **Done = James가 dev 실환경에서 "카드 더 찾기" 1회 → trace 여정을 빈칸 없이 재구성 확인.**
> 실행 = James (dev, read-only SQL). SSOT = James 화면.
>
> 코드 위치: `feat/search-trace-observability-phase1` (`47fd060e`, origin push 완료).
> 스키마: `search_trace`(요청당) + `search_trace_candidate`(후보당). dev DB DDL 적용됨
> (로컬 docker `supabase-db-dev`, 2 테이블 + 11 인덱스). **prod DDL = ship 시 선적용→머지.**

---

## 실행 레시피 (James, dev)

```
1) dev API env:  SEARCH_TRACE_ENABLED=true   +   V5_PICKER_MODE=cell_binning
   - V5_POOL_* 는 OFF 유지 (라이브 경로만 검증).
   - ⚠️ LLM-ban: cell_binning 만 사용 (OpenRouter 미호출). picker LLM 경로 금지.
   - dev DB DDL 은 이미 적용됨.
2) 실제 만다라에서 "카드 더 찾기" 1회 실행.
   - add-cards 응답의 roundId = search_trace.trace_id (대조용, 아래 SQL은 자동조인이라 불필요).
3) dev DB 접속 후 아래 Q1~Q4 실행:
      docker exec supabase-db-dev psql -U postgres -d postgres
```

각 쿼리는 `WITH latest AS (...)` 로 "가장 최근 add_cards trace"를 자동 조인 — trace_id 수동 복사 불필요.

---

## Q1 — 요청 요약 (최근 add_cards 1건)

```sql
SELECT trace_id, quota_units, queries_attempted, queries_succeeded, queries_failed,
       counts, outcome, algorithm_version, started_at, finished_at
FROM public.search_trace
WHERE trigger = 'add_cards'
ORDER BY created_at DESC
LIMIT 1;
```

## Q2 — 여정 분해 (decision × drop_reason × stage)

```sql
WITH latest AS (
  SELECT trace_id FROM public.search_trace
  WHERE trigger = 'add_cards' ORDER BY created_at DESC LIMIT 1
)
SELECT c.decision, c.drop_reason, c.stage_reached, count(*) AS n
FROM public.search_trace_candidate c JOIN latest USING (trace_id)
GROUP BY 1,2,3
ORDER BY n DESC;
```

## Q3 — 후보별 상세 (PLACED + 라이브 sync gc/cosine/ts=null 스팟체크)

```sql
WITH latest AS (
  SELECT trace_id FROM public.search_trace
  WHERE trigger = 'add_cards' ORDER BY created_at DESC LIMIT 1
)
SELECT c.video_id, c.source_kind, c.source_cell_index, c.decision, c.drop_reason,
       c.stage_reached, c.llm_pick_score, c.final_cell_index,
       c.relevance_gc, c.cosine, c.ts_rank
FROM public.search_trace_candidate c JOIN latest USING (trace_id)
ORDER BY (c.decision='PLACED') DESC, c.drop_reason NULLS FIRST, c.video_id;
```

## Q4 — 정합 어서션 ("빈칸 없이" + 관찰-only 불변, 한 줄로)

```sql
WITH latest AS (
  SELECT trace_id, counts FROM public.search_trace
  WHERE trigger = 'add_cards' ORDER BY created_at DESC LIMIT 1
),
cand AS (SELECT c.* FROM public.search_trace_candidate c JOIN latest USING (trace_id))
SELECT
  (SELECT count(*) FROM cand)                                                       AS candidates,
  (SELECT count(*) FROM cand WHERE decision='PLACED')                               AS placed,
  (SELECT count(*) FROM cand WHERE decision='DROPPED' AND drop_reason IS NULL)      AS dropped_no_reason,   -- 반드시 0
  (SELECT count(*) FROM cand WHERE decision='PLACED'  AND drop_reason IS NOT NULL)  AS placed_with_reason,  -- 반드시 0
  (SELECT count(*) FROM cand WHERE relevance_gc IS NOT NULL OR cosine IS NOT NULL)  AS live_sync_scored,    -- 반드시 0 (sync=LLM/임베딩 없음)
  (SELECT count(*) FROM cand WHERE drop_reason='not_picked')                        AS not_picked,          -- 오버픽 시 >0 (picker 작동)
  (SELECT count(DISTINCT video_id) FROM cand) = (SELECT count(*) FROM cand)         AS no_double_keyed,     -- true
  (SELECT (counts->>'placed')::int FROM latest)                                     AS counts_placed;        -- 위 placed 와 대조
```

---

## PASS 판정 기준

- **Q1**: `quota_units` 실수치(≈ search.list 호출수 × 100), `outcome`에 cards_count/empty_cells.
- **Q2**: 사유가 **빈칸 없이** 열거 —
  - A (fanout, stage=`fanout`): off_lang / blocklist / shorts
  - B (executor 끝단): excluded_owned(exclude) / series_dedup(diversity) / not_picked(picker) / slice_overflow(slice) / shorts(short_gate) / **PLACED(placed)**
  - C (add-cards 표시필터, stage=`display_filter`): filter_min_views / filter_duration / filter_published_after
- **Q4** (수치 PASS): `dropped_no_reason=0` · `placed_with_reason=0` · `live_sync_scored=0` · `no_double_keyed=true` · `not_picked>0`(오버픽 시) · `placed = counts_placed`.
- **참고 (서빙 동일)**: 같은 만다라로 `SEARCH_TRACE_ENABLED=false` 1회 더 → 반환 카드 id 셋 비교.
  실 YouTube 변동으로 완전동일 안 나와도 **실패 아님** — 결정 무변경 엄밀 증명은 hermetic 테스트
  (`v5-search-trace.test.ts`, flag on/off 바이트동일)가 이미 담당. (A)의 본질 = 실환경 여정 재구성.

---

## 결과 기록 (James — 실행 후 여기에 붙여넣기 → STEP 3 Done 근거)

```
Q1 결과:
Q2 결과:
Q3 결과(요약):
Q4 결과:
서빙동일 참고(on/off id 셋):
판정: PASS / FAIL
날짜/환경:
```

---

## (A) Done 후 순서

1. **STEP 3 잔여** (add-cards 검증 패턴 복제):
   - wizard precompute emission (+ `quota_units` MISS 경로 기록)
   - pool-serve emission (gc = gate값 ✓ / ts_rank = rec_score ✓ / source_tier = SELECT 추가)
2. **STEP 4** Trace Explorer (AdminRoute 확장, mandala_id/trace_id → 카드 여정).
3. **Phase 2** (베타 크리티컬): 일일 롤업 job(pg-boss/node-cron) + admin 메일(`mailer.ts`, delta + 🔴8키 알람) + 5축 메트릭.

## 불변
prod DDL = ship 시 선적용→머지 · prod 직접조작 금지 · 관찰-only(서빙 결과 불변) · LLM-ban(cell_binning) · DB타겟 = 로컬 docker 확인.
