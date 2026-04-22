# Design — Wizard Pre-compute Pipeline (Phase 2, SLO-1)

**Date**: 2026-04-22
**Owner**: CP417+
**Status**: DRAFT (설계 승인 대기)

---

## 핵심 목표 (1줄)

위저드 save 완료 시점에 대시보드 첫 카드가 **≤1s** 로 나타나게 한다 (SLO-1 체감 즉시).

## 본질 (1줄)

"계산은 이미 끝나 있어야 한다" — 사용자가 Step 1 제목을 확정한 순간부터 서버가 discover 를 시작해, Step 3 저장 이전에 카드가 precompute 되어 있어야 사용자 지각 시간 = 0.

## 컨셉 (1줄)

Step 1→2 전환에서 이미 hit 되는 `/wizard-stream previewOnly=true` endpoint 에 **video discover 병렬 track** 을 추가 — 결과를 `mandala_wizard_precompute` 테이블에 `session_id` 키로 저장. Step 3 save 시 그 session_id 로 lookup → `recommendation_cache` 로 이전 → SSE backlog 즉시 emit.

---

## 제약 / 전제

- **신규 인프라 금지** (Redis Stream / Kafka 제외). 현재 스택: Postgres + pg_cron + Supabase + Fastify
- `POST /api/v1/mandalas` 계약 변경 금지 (body 에 optional `session_id` 만 추가)
- `useWizard` 수정 최소 — 새 session_id 발행 + body 에 포함 수준
- Phase 3B (pool 확장) 완료 여부와 **무관** (pool 규모가 작아도 precompute 저장소는 동작)

---

## 설계

### 데이터 모델

```sql
-- migration: prisma/migrations/wizard-precompute/001_table.sql
CREATE TABLE IF NOT EXISTS public.mandala_wizard_precompute (
  session_id      UUID PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  goal            TEXT NOT NULL,
  language        VARCHAR(5) NOT NULL,
  focus_tags      TEXT[],
  status          VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending|running|done|failed|consumed
  discover_result JSONB,          -- step2_result shape (slots array)
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes'
);
CREATE INDEX idx_precompute_user_created ON public.mandala_wizard_precompute(user_id, created_at DESC);
CREATE INDEX idx_precompute_expires ON public.mandala_wizard_precompute(expires_at) WHERE status != 'consumed';
```

TTL sweep (pg_cron):
```sql
SELECT cron.schedule('precompute-ttl-sweep', '*/5 * * * *',
  $$DELETE FROM mandala_wizard_precompute WHERE expires_at < NOW() AND status != 'consumed'$$);
```

### Flow

```
[Step 1 goal 확정]
   │  FE: sessionId = randomUUID()
   │  POST /api/v1/mandalas/wizard-stream?previewOnly=true
   │  body: { goal, language, focus_tags, session_id }
   ▼
[BE /wizard-stream handler]
   │  기존 structure-gen 응답 즉시 반환 (변경 없음)
   │  NEW: setImmediate(() => startPrecompute(session_id, goal, ...))
   ▼
[startPrecompute — fire-and-forget]
   │  INSERT mandala_wizard_precompute (status=running)
   │  runV3Discover(ephemeralContext) — mandala_id 없이 동작 가능하게 executor 리팩토
   │  UPDATE discover_result, status=done
   ▼
[Step 3 save]
   │  FE: POST /create-with-data body.session_id 포함
   ▼
[BE /create-with-data handler]
   │  기존 wizard save tx 수행
   │  NEW: tx 후 session_id 로 mandala_wizard_precompute lookup
   │       - status=done AND expires_at > NOW() → INSERT recommendation_cache rows
   │       - mark status=consumed
   │       - cardPublisher.notify(mandalaId, ...) 연쇄 → SSE backlog emit
   │  miss 시 기존 post-creation pipeline 경로로 fallback
```

### 계약 변경

1. `/wizard-stream`: body 에 optional `session_id` 추가. 없으면 precompute 스킵 (backward-compat).
2. `/create-with-data`: body 에 optional `session_id` 추가. 없으면 기존 post-creation pipeline 사용.

### Invalidation

- 제목 재편집: FE 가 기존 sessionId 폐기 + 새 sessionId 발행 + 새 `/wizard-stream` 호출
- 서버 측 invalidation 별도 없음 — 옛 row 는 TTL 로 정리 (10min)
- user_id 별 최근 N개만 보존하는 quota 는 v2 로 이월

### Fallback

- precompute miss (session_id 없음 / status ≠ done / expired) → 기존 post-creation pipeline 그대로 실행
- discover 실패 (status=failed) → miss 로 간주 + 기존 경로

### Feature flag

- `WIZARD_PRECOMPUTE_ENABLED` (compose env, default `false`)
- flag off 시: `/wizard-stream` 측에서 precompute 안 시작. `/create-with-data` 측에서 session_id lookup 안 함. 기존 동작 100% 보존.

---

## Risk / Rollback

| Risk | 완화 |
|------|------|
| discover 병렬 실행이 OpenRouter/YouTube quota 를 2배 소모 | quota exhausted 시 precompute 실패 → miss 로 자연 fallback. 추가 비용 = quota 한도 내 실 사용량 |
| precompute 가 틀린 결과 (goal 변경 전 version) 를 저장 | session_id 가 매 편집마다 재발행되므로 stale 은 TTL 로 제거 + consumed 시점에 goal match 검사 |
| mandala_wizard_precompute row 폭증 | expires_at + pg_cron 로 자동 정리. 사용자당 최대 ~3 row (10분 TTL) |
| discover 에서 수백 row 를 recommendation_cache 로 복사 시 lock | tx 밖에서 별도 세션으로 복사. INSERT … ON CONFLICT DO NOTHING |

**Rollback**: `WIZARD_PRECOMPUTE_ENABLED=false` 1-line env flip. code revert 불필요.

---

## 측정

- Target: `create-with-data` 응답 후 → 첫 SSE `card_added` event 수신까지 **≤1s** (브라우저 측 stopwatch)
- 지표: `SELECT AVG(EXTRACT(EPOCH FROM (consumed_at - created_at))) FROM mandala_wizard_precompute WHERE status='consumed'` — 평균 precompute→consume 간격
- Miss rate: `status='failed' OR status != 'consumed' by consume-time` 비율

---

## Non-goals (scope 밖)

- session_id 가 없는 경로 (프로그램matic mandala 생성, template 등) — 기존 pipeline 그대로
- Search 재검색 시 precompute — Phase 3A 영역
- Redis 기반 구현 — 아래 근거로 배제

## Redis vs 테이블 결정 근거

**테이블 채택**. 근거:
1. Redis 는 이미 video-dictionary 전용 pod. wizard precompute 섞으면 scope 혼선 + trace 복잡화
2. 테이블은 persistent — server restart 시 in-flight precompute 보존 (10min TTL 내 복구 가능)
3. pg_cron TTL sweep 이미 self-hosted Supabase 에 확장 설치됨 (별도 worker 불필요)
4. Debug/trace 가 SQL 로 쉬움 (`SELECT * FROM mandala_wizard_precompute WHERE user_id=...`)
5. throughput 요구 낮음 (user 당 ~분당 1회 발행) — Redis 의 낮은 latency 이점 불필요
