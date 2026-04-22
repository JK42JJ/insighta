# Design — Tier 2 Quality Gate (독립 축, 별도 PR)

**Date**: 2026-04-22
**Owner**: CP417+
**Status**: DRAFT (승인 대기)

---

## 핵심 목표 (1줄)

Tier 2 realtime 경로에 **view count + engagement 최소 기준** 을 적용해 "조회수 4" 류 저품질 카드 노출을 차단한다.

## 본질 (1줄)

pool 재충전과 관계없이 **즉시 효과**. 독립 축이므로 pool size 영향을 A/B 측정하려면 반드시 다른 변경과 분리되어야 한다.

## 컨셉 (1줄)

Tier 2 enrich 완료 → mandala-filter 진입 **직전** 에 bronze-floor 필터 삽입. Tier 1 cache 는 이미 저장 시점 적용됨 (executor.ts:591 주석), Tier 2 만 의도적으로 제외되어 있던 것을 **flag 로 제어 가능한 안전망**으로 승격.

---

## 제약 / 전제

- **별도 PR** (핸드오프 8번 금기). 다른 변경과 묶지 않음
- pool size 감소 가능성 → **default off** 로 ship, 나중 flip
- Phase 3B 구현 전/후 어느 시점에서도 독립 적용 가능

---

## 설계

### 환경 변수

| env | default | 의미 |
|---|---|---|
| `V3_ENABLE_QUALITY_GATE` | `false` | gate on/off. default off (unset = no-op, 기존 동작 보존) |
| `V3_MIN_VIEW_COUNT` | `1000` | 절대 조회수 floor (Tier 1 bronze 기준과 동일) |
| `V3_MIN_VIEWS_PER_DAY` | `10` | `view_count / max(1, days_since_publish)` — 발행일 대비 인기도 |

### 삽입 지점

`src/skills/plugins/video-discover/v3/executor.ts:627` 전후 (`debug.timing.filterMs` 직전):

```ts
// Tier 2 quality gate (독립 flag, 별도 PR)
if (v3Config.enableQualityGate) {
  const tQualStart = Date.now();
  const now = Date.now();
  const before = enriched.length;
  const minView = v3Config.minViewCount;
  const minVpd = v3Config.minViewsPerDay;
  for (let i = enriched.length - 1; i >= 0; i--) {
    const e = enriched[i];
    const view = e.viewCount ?? 0;
    const ageMs = e.publishedDate ? now - e.publishedDate.getTime() : 1;
    const days = Math.max(1, ageMs / 86_400_000);
    const vpd = view / days;
    if (view < minView || vpd < minVpd) {
      enriched.splice(i, 1);
    }
  }
  debug.droppedQuality = before - enriched.length;
  debug.timing.qualityGateMs = Date.now() - tQualStart;
}
```

Tier2Debug 필드 추가:
```ts
interface Tier2Debug {
  timing: { ...기존..., qualityGateMs: number };
  ...기존...
  droppedQuality: number;
}
```

config.ts 추가 (zod):
```ts
enableQualityGate: z.coerce.boolean().default(false),
minViewCount: z.coerce.number().int().min(0).default(1000),
minViewsPerDay: z.coerce.number().int().min(0).default(10),
```

### Test

`tests/unit/skills/video-discover/v3/quality-gate.test.ts`:
- gate off → pass-through (기존 동작)
- gate on + view=500 → drop
- gate on + view=1500, 발행 30일, vpd=50 → pass
- gate on + view=2000, 발행 300일, vpd=6.7 → drop
- gate on + view=5000, publishedDate null → drop (guard)
- gate on + enriched=[] → no-op

---

## Risk / Rollback

| Risk | 완화 |
|------|------|
| Pool size 30%+ 급감 | **default off** 로 ship. flip 후 1시간 동안 `debug.droppedQuality` 분포 관측. 과감하면 threshold 하향 |
| 특정 mandala 는 quality 낮은 영상이 유일한 source | flip 전 샘플 QA 필요. 필요 시 mandala.focus_tags 기반 bypass 고려 (v2 이월) |

**Rollback**: `V3_ENABLE_QUALITY_GATE=false` 1-line. code revert 불필요.

---

## 측정 / A/B

Phase 1 (baseline, gate off): 1주일간 pool size 분포 (mean / p10 / p90) 기록.
Phase 2 (gate on): 1주일간 같은 지표 측정.
- Pool size **10% 내 감소** → OK, gate 유지
- **10~30% 감소** → threshold 하향 검토 (`minViewCount=500` 등)
- **30%+ 감소** → gate 디자인 재검토 (mandala type 별 threshold?)

지표:
- `SELECT AVG(total_recommendations), PERCENTILE_CONT(0.1) WITHIN GROUP (ORDER BY total_recommendations) FROM mandala_pipeline_runs WHERE step2_started_at > $window_start`
- `SELECT AVG((step2_result->'debug'->>'droppedQuality')::int) FROM ...`

---

## Non-goals

- Quality tier 가중치 tuning (silver/gold 선호) — Phase 3A 의 scoring 단계 영역
- 발행일 1년 이상 영상 우대 / 역차별 — recency weight 로 따로 조절 (현 env `V3_RECENCY_WEIGHT`)
- Channel authority / subscriber count 기반 gate — channel_whitelist 로 이미 간접 해결
- Tier 1 cache 측 gate — 이미 저장 시점 bronze floor 적용됨 (중복 불필요)
