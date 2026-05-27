# v2 Quality Audit + Cumulative LLM Improvement System

**Status**: Design draft — implementation deferred to a fresh session.
**Date**: 2026-05-27
**Owner**: TBD (next session pickup)
**Origin incident**: CP488+ session — 7 PRs + ~8h burn fixing v2 hallucination patches one layer at a time. Sonnet 4.6 swap (PR #754) shipped, then user-reported video `XrlKWAIFQUY` (15:01 long, sections 0–23:00, atoms timestamp_sec up to 1260s) still hallucinated. Single-PR patches do not scale; this doc defines the systemic safety net.

---

## 0. Why this exists (정직한 회고)

본 conversation 의 burn:
- 7 PRs 작성 (#752 ~ #758)
- 다수 deploy fail / cancelled
- 응급 patch + redeploy
- 사용자 trust 손상 누적
- 본 영상의 hallucination 여전 미해결

근본 원인:
1. **End-to-end pipeline review 부재** — 6 layer (captioner → fetch → generator → prompt → LLM → validator) 중 4 layer 가 정보 손실. CC 가 처음에 layer 1-2 만 보고 patch.
2. **단편 patch 반복** (CLAUDE.md LEVEL-3 "단편 조치 금지" 위반 ×6)
3. **사용자 요구 vs 시스템 capability gap 인지 부족** — "정확한 chapter" 가 본질이지만 transcript fullText join 으로 timestamp 폐기되는 구조 인지 못 함
4. **자동 hide 정책의 cost** — PR #752 가 broken row 자동 차단 → 서비스 일부 중단 → 사용자 trust 손상 (사용자 명시: "차단보다는 인식이 본질, 무중단 변경/개선 적용 필요")

**대책 — 단순 더 강한 patch 가 아니라 systemic observability + LLM-driven iteration**.

---

## 1. 본질 목표

Insighta v2 의 본질 = **사용자가 영상 안 보고 chapter 만 따라가도 학습 가능**. 시간 클릭 → 영상의 그 시간에 정말 그 내용이 있어야. 무너지면 service 가 학습 시간 늘리는 도구로 역행.

→ **정확성 = service 생명선. 단 자동 차단으로 사용자 노출 끊는 것도 service 생명선 침해**.

타협: **무중단 노출 + 매일 자동 평가 + 누적 history + LLM-driven 분석 + 점진 background 재생성**.

---

## 2. Design principles

| 원칙 | 의미 |
|---|---|
| **Detection, not blocking** | broken row 도 사용자 노출 그대로. hide / 자동 차단 X. 단 시스템이 알고 있음 |
| **Observability over patches** | 매일 audit 가 자동 surface. 단편 patch 안 함 |
| **LLM-driven improvement** | 누적 audit data 를 LLM 이 분석 → root cause / 개선 spec 자동 generate |
| **Background regen** | broken row 의 재생성 = 사용자 모르게 진행. 다음 view 시 자동 좋아짐 |
| **No hardcoded thresholds without config** | 모든 audit threshold 는 `src/config/**` zod-driven |
| **End-to-end smoke in CI** | prod 진입 전 본 case 류 hallucination 자동 차단 |

---

## 3. Audit metrics (8 dimensions)

| Metric | 계산 | 100 score 기준 |
|---|---|---|
| **M1 Range fit** | `sections.last.to_sec / duration_seconds` | 0.95–1.05 = 100; 차이 클수록 감점 |
| **M2 Coverage start** | `sections.first.from_sec` | ≤ 60s = 100; 1분 초과 시 점수 감소 |
| **M3 Coverage end** | `(duration - sections.last.to_sec) / duration` | -0.05~0.05 = 100; 초과/누락 시 감점 |
| **M4 Atoms range fit** | `atoms.max(timestamp_sec) / duration_seconds` | 0.85–1.05 = 100 |
| **M5 Atoms distribution** | `stddev(atoms.timestamp_sec) / (duration/2)` | 0.4–0.6 = 100 (균등 분포) |
| **M6 Atoms sorted** | timestamp_sec ascending 여부 | sorted = 100, 아니면 0 |
| **M7 Sections gap** | sum of gaps / duration | 0% = 100; 5%+ = 0 |
| **M8 One-liner length** | core.one_liner.length | ≤ 20 chars = 100; > 30 = 0 |

**Overall score** = 단순 평균 (8 metric × 12.5점). Future: weighted (M1/M4/M7 가 사용자 trust 직결).

**Threshold**:
- `≥ 85`: pass (사용자 노출 그대로, 별 indicator X)
- `70–84`: warning (노출 그대로 + admin dashboard 에 표시, regen queue 등록)
- `< 70`: critical (노출 그대로, regen 우선순위 ↑, alert)

---

## 4. Data lineage

### 4.1. Audit run

```
매일 04:00 UTC cron
  ↓
SELECT all v2 rows (template_version='v2') + JOIN youtube_videos.duration_seconds
  ↓
8 metric 계산 (script, no LLM call)
  ↓
v2_quality_audit_log INSERT (1 row per video per audit run)
  ↓
critical row → regen_queue INSERT (background)
  ↓
audit_run summary row INSERT (총 N rows, 평균 score, model 별 분포)
```

### 4.2. Schema

```sql
-- 매일 영상별 점수
CREATE TABLE v2_quality_audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id        VARCHAR(11) NOT NULL,
  audit_date      DATE NOT NULL,
  audit_run_id    UUID NOT NULL,                   -- 그 날의 audit run
  overall_score   SMALLINT NOT NULL CHECK (overall_score BETWEEN 0 AND 100),
  m1_range_fit    SMALLINT,
  m2_coverage_start SMALLINT,
  m3_coverage_end SMALLINT,
  m4_atoms_range  SMALLINT,
  m5_atoms_distribution SMALLINT,
  m6_atoms_sorted SMALLINT,
  m7_sections_gap SMALLINT,
  m8_oneliner_len SMALLINT,
  model           VARCHAR(80),
  duration_seconds INT,
  violations      JSONB,                            -- 위반 metric + 값
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (video_id, audit_date)
);

CREATE INDEX idx_audit_video_date ON v2_quality_audit_log (video_id, audit_date DESC);
CREATE INDEX idx_audit_score_date ON v2_quality_audit_log (audit_date, overall_score);

-- 매일 audit run summary
CREATE TABLE v2_quality_audit_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_date        DATE NOT NULL UNIQUE,
  total_videos    INT NOT NULL,
  pass_count      INT NOT NULL,
  warning_count   INT NOT NULL,
  critical_count  INT NOT NULL,
  avg_score       REAL,
  by_model        JSONB,                            -- {model: {count, avg_score}}
  by_violation    JSONB,                            -- {metric: count}
  llm_report_id   UUID,                             -- LLM analysis 결과 (optional)
  started_at      TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  status          VARCHAR(20) NOT NULL              -- 'running' | 'completed' | 'failed'
);

-- 재생성 큐
CREATE TABLE v2_quality_regen_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  video_id        VARCHAR(11) NOT NULL,
  priority        SMALLINT NOT NULL DEFAULT 5,      -- 1=critical, 10=low
  reason          TEXT,                              -- "M1 score 25 (range over-shoot)"
  enqueued_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempted_at    TIMESTAMPTZ,
  resolved_at     TIMESTAMPTZ,
  status          VARCHAR(20) NOT NULL DEFAULT 'pending'  -- 'pending' | 'in_progress' | 'resolved' | 'failed'
);

CREATE INDEX idx_regen_pending ON v2_quality_regen_queue (status, priority) WHERE status = 'pending';
```

---

## 5. LLM-driven cumulative analysis

### 5.1. 흐름

매주 (cron Sunday 05:00 UTC, daily audit 완료 후):

1. 지난 7일 audit history collect — 영상별 score trend + model 별 분포 + violation cluster
2. LLM (Sonnet 4.6, production OpenRouter — CLAUDE.md Hard Rule 의 "service 전용" 에 정합) 에게 input:
   - "지난 7일 의 v2 quality audit 결과" structured JSON
   - "이전 주의 LLM report" (있으면)
   - Prompt: "broken pattern cluster 식별 + root cause 추정 + 개선 권장"
3. LLM output → `v2_quality_llm_reports` table 저장
4. Admin dashboard 표시 + Slack/email 알림

### 5.2. LLM prompt 구조

```
You are the Insighta v2 quality monitor. The system tracks daily audit
scores for ~2,000 video summaries against 8 metrics. Below is the past
7 days of audit data + the prior week's LLM report.

Task:
1. Identify the top 3 broken patterns (e.g., "Sonnet 4.6 rows with
   long-form lectures over-shoot M1 range").
2. For each pattern, propose root cause (data lineage / prompt /
   model / validator).
3. Recommend 1-3 concrete fixes (code, prompt, config, data flow).
4. Compare with last week's report — improving? Same? Worse?
5. Surface any new model / pattern emerging this week.

Output: JSON with `patterns`, `recommendations`, `trend`, `alerts`.
```

### 5.3. LLM report table

```sql
CREATE TABLE v2_quality_llm_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_period_start DATE NOT NULL,
  report_period_end   DATE NOT NULL,
  model           VARCHAR(80) NOT NULL,
  prior_report_id UUID REFERENCES v2_quality_llm_reports(id),
  patterns        JSONB NOT NULL,                   -- top 3 broken patterns
  recommendations JSONB NOT NULL,                   -- concrete fixes
  trend           VARCHAR(20),                       -- 'improving' | 'stable' | 'worsening'
  alerts          JSONB,                             -- new patterns
  raw_input_sample TEXT,                             -- audit data sent (debugging)
  raw_output      TEXT,                              -- LLM raw response
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 6. Background regen queue

### 6.1. 처리 path

```
v2_quality_regen_queue (priority ASC, enqueued_at ASC)
  ↓
매 30분 background worker (pg-boss 또는 simple cron)
  ↓
1 row pick → fetch transcript (if needed) → generateRichSummaryV2(forceRegen=true)
  ↓
새 audit metric 계산 → pass 면 DB UPDATE + queue resolve
                  → critical 면 attempted_at stamp + retry 1회 후 'failed' marker
```

### 6.2. 사용자 영향

- 사용자가 영상 보는 동안 = **노출 그대로** (broken chapter 도 표시, 단 시스템이 알고 있음)
- 다음 view 시점 = **자동 좋아진 chapter**
- 사용자 입장에서는 service 끊긴 적 없음 + 시간 지나면 자동 개선

---

## 7. PR #752 의 자동 hide 정책 재검토

본 design 의 원칙 = **detection, not blocking**.

PR #752 의 FE 가드 (`isQualityLow` 시 "이 영상의 AI 분석을 개선하고 있습니다" 메시지 + chapter 영역 hide) = **자동 차단 → 사용자 spec 위반**.

### 7.1. 재검토 옵션

| Option | 사용자 노출 |
|---|---|
| **A. PR #752 hide 정책 revert** — broken chapter 그대로 노출 | 가장 honest, 단 broken chapter 자체가 trust 손상 가능 |
| **B. Hide 제거 + subtle indicator** (예: "AI 분석 정확도: N%") | 사용자가 자체 판단. 노출 + 시스템 평가 |
| **C. 현 hide 유지 + Background regen 으로 broken 영상이 빨리 사라지게** | 단기 hide + 자동 회복 |

→ **B 권장**: 사용자 spec ("차단보다는 인식") 정확 honor. score 가 dashboard 에 자동 노출 + 사용자에게 transparent.

### 7.2. Migration plan

- Daily audit 활성 후 7일 안 broken row 의 평균 score 측정
- B 구현 (FE indicator) 후 hide 정책 점진 해제
- regen queue 가 critical row 우선 처리 → 7일 후 critical count → 0 목표

---

## 8. End-to-end smoke test (CI gate)

### 8.1. 의미

prod 에 ship 되는 generator / prompt 변경이 hallucination 양산 시 CI 에서 즉시 fail. PR #754 의 Sonnet 4.6 swap 가 본 gate 있었으면 deploy 전에 발견.

### 8.2. Spec

```ts
// tests/e2e/v2-generation-smoke.test.ts
test('v2 generation produces valid sections for known 10min video', async () => {
  // Mock transcript (timestamped, 600 chars × 10 = 6000 chars)
  const result = await generateRichSummaryV2({
    videoId: 'TEST_10MIN',
    transcript: MOCK_TRANSCRIPT,
    forceRegen: true,
  });

  const audit = computeAuditScore(result.segments, /*duration*/ 600);
  expect(audit.m1_range_fit).toBeGreaterThanOrEqual(80);
  expect(audit.m2_coverage_start).toBeGreaterThanOrEqual(80);
  expect(audit.m4_atoms_range).toBeGreaterThanOrEqual(80);
  expect(audit.overall_score).toBeGreaterThanOrEqual(70);
});
```

**Cost**: 영상당 ~$0.07 (Sonnet 4.6), CI 마다 ~1회 = $0.07/PR. 부담 없음.

### 8.3. CI gate enforcement

CI workflow 에 `e2e:v2-smoke` job 추가 → PR merge 차단 (CODEOWNERS 또는 branch protection).

---

## 9. Admin dashboard

### 9.1. UI 구조

`/admin/v2-quality` 페이지:

1. **Latest audit run summary** — total / pass / warning / critical counts + avg score
2. **Daily score trend** (line chart, last 30 days) — overall + by model
3. **Violation cluster** (bar chart) — 각 metric 별 violation count
4. **Critical video list** (sortable table) — video_id / title / score / model / 위반 reason / regen status
5. **Latest LLM report** — patterns / recommendations / trend
6. **Manual regen trigger** — admin 이 특정 video_id 의 regen queue priority 강제 boost

---

## 10. Config (zod schema)

```ts
// src/config/v2-quality-audit.ts
export const v2QualityAuditEnvSchema = z.object({
  V2_QUALITY_AUDIT_ENABLED: boolFlag.default(false), // 기본 OFF; phased rollout
  V2_QUALITY_AUDIT_CRON: z.string().default('0 4 * * *'),  // daily 04:00 UTC
  V2_QUALITY_AUDIT_PASS_SCORE: positiveInt.transform((v) => v ?? 85),
  V2_QUALITY_AUDIT_WARNING_SCORE: positiveInt.transform((v) => v ?? 70),
  V2_QUALITY_AUDIT_LLM_REPORT_CRON: z.string().default('0 5 * * 0'), // Sunday 05:00 UTC
  V2_QUALITY_AUDIT_LLM_MODEL: z.string().default('anthropic/claude-sonnet-4-6'),
  V2_QUALITY_AUDIT_REGEN_BATCH_SIZE: positiveInt.transform((v) => v ?? 10),
  V2_QUALITY_AUDIT_REGEN_INTERVAL_MIN: positiveInt.transform((v) => v ?? 30),
});
```

모든 threshold / cron / model = env 으로 tunable. 코드 변경 X.

---

## 11. Implementation phases

### Phase 1 — MVP (2-3 일)

- [ ] Schema migration (`v2_quality_audit_log` + `audit_runs` + `regen_queue`)
- [ ] Audit metrics 계산 함수 (`src/modules/skills/rich-summary-quality-audit.ts`)
- [ ] Daily cron (`src/modules/scheduler/v2-quality-audit-cron.ts`)
- [ ] Smoke test in CI
- [ ] Admin dashboard read-only (table view)
- [ ] Config env

**효과**: 매일 audit 실행, history 누적, smoke gate ship 차단.

### Phase 2 — LLM analysis (1-2 일)

- [ ] LLM weekly cron + prompt
- [ ] `v2_quality_llm_reports` table
- [ ] Admin dashboard LLM report view
- [ ] Slack/email alert webhook

**효과**: 사람 operator 안 봐도 broken pattern 자동 surface.

### Phase 3 — Background regen (1-2 일)

- [ ] Regen worker (pg-boss or simple cron)
- [ ] Priority queue 처리
- [ ] Regen 후 audit score 재측정 + queue resolve
- [ ] Admin manual regen trigger

**효과**: 자동 점진 개선. 사용자 무중단.

### Phase 4 — PR #752 hide 정책 재검토 (0.5 일)

- [ ] FE 의 isQualityLow hide 정책 → subtle indicator (option B)
- [ ] 또는 hide 완전 제거 (option A)
- [ ] 사용자 노출 회복

**효과**: 본 design 의 "detection, not blocking" 완성.

### Phase 5 — Multi-week refinement (ongoing)

- [ ] Audit metric weight 조정 (사용자 본 시점 의 실 broken 패턴 기반)
- [ ] LLM prompt 개선 (recommendation 정확도 ↑)
- [ ] Regen 의 success rate 측정 + 재생성 rate optimization

---

## 12. Risks + open questions

| Risk | Mitigation |
|---|---|
| Audit metric 자체가 잘못 정의되어 healthy row 도 critical 분류 | Phase 5 의 weight 조정 + 실 사용자 사례 검토 |
| LLM analysis 결과가 noise 또는 hallucinate | LLM report 의 raw_output 저장 + admin manual review 단계 추가 |
| Regen queue 가 cron 양산 시 cost 폭발 | priority + batch size + interval env 으로 cap. 예상 cost ~$10/day worst case |
| Background regen 시 사용자가 마침 그 영상 보고 있으면 race condition | Optimistic write + FE 가 invalidate + refetch (이미 PR #752 path 활용) |
| `e2e:v2-smoke` test 가 LLM 변동성으로 가끔 fail | retry 2회 + threshold 80 (95 X) |
| Audit data 폭발 (1,800 row × 365 day = 660K row/year) | partition by month + 90일 후 hourly aggregate 로 압축 |

**Open questions**:
- Audit metric weight 의 초기 값 — equal 또는 M1/M4 heavy?
- LLM analysis cadence — 매주 충분? 매일 필요?
- Regen 의 LLM model — Sonnet 4.6 fixed 또는 model 별 retry?
- Subtle indicator (Phase 4 option B) 의 UX — 사용자 noise 가능성?
- Critical row 의 사용자 noti — silent 또는 transparent?

---

## 13. 본 design 이 본 conversation 의 burn 을 어떻게 막는가

| 본 conversation 의 단편 patch | 본 design 이 미리 잡았을 path |
|---|---|
| PR #752 (qwen3_low hide) — 사용자 보고 후 reactive | 매일 audit 가 qwen3 row 의 M1/M6 violation 즉시 surface |
| PR #754 (Sonnet 4.6 swap) — model swap 했지만 hallucinate 잔존 | Phase 1 smoke gate 가 deploy 차단 (10분 mock video 의 over-shoot detect) |
| PR #758 (90분 cap) — duration 기반 skip 추가 | Audit metric 이 영상별 score 자동 → cap 결정도 data-driven |
| 본 영상 XrlKWAIFQUY hallucinate | 다음 day audit 가 M1 score 65 (1380/901=1.53) detect → critical → regen queue → 자동 회복 |
| CC 의 단편 진단 반복 | Weekly LLM report 가 "Sonnet 4.6 row 의 80% 가 M1 over-shoot" 자동 cluster → root cause (prompt duration 누락) 추천 |

→ **본 design 의 ROI = 미래 1 incident 당 6+ PR + 8h burn 회피 ≈ 사용자 시간 + CC subscription + OpenRouter cost 모두 save**.

---

## 14. Next session pickup

다음 session 시작 시 본 doc 의 Phase 1 부터:

1. `git checkout main && git pull`
2. `docs/design/v2-quality-audit-system-2026-05-27.md` 본 doc 전체 read
3. Phase 1 task breakdown:
   - schema migration → local + prod
   - audit metrics 함수 + unit test
   - daily cron + config
   - smoke test in CI
   - admin dashboard 의 read-only table
4. Per-step PR ship (각 PR 별 review)

**본 doc 의 위치**: `docs/design/v2-quality-audit-system-2026-05-27.md` (영구).

**관련 prior incidents** (참조):
- 본 conversation 의 PR #752 ~ #758
- 사용자 보고 영상: `3T75_phv4cA`, `WeGhEF1kckM`, `3DsejtPP25A`, `XrlKWAIFQUY`, `flY9rxu0g38`
- Backfill JSONL: `/tmp/qwen3-low-transcripts.jsonl` (493 영상, 484 transcript OK)

---

## 15. Hard rule alignment (CLAUDE.md)

- ✅ **하드코딩 + 단편 조치 금지** — 모든 threshold / cron / model 이 zod config
- ✅ **추측 전 소스 읽기** — Phase 1 시작 전 본 doc 의 모든 layer pipeline read 의무
- ✅ **계획 → 승인 → 실행** — phase 별 사용자 ok 받음
- ✅ **LLM API 호출** — Phase 2 의 LLM 호출 = production service path (운영 분석), CLAUDE.md "데이터셋 생성·실험·테스트" 와 다름. 정합.
- ✅ **Pre-push verification** — Phase 1+ 의 모든 PR 이 /verify gate
- ✅ **GitHub English only** — 본 doc + 향후 PR 모두 영문 PR title/body
