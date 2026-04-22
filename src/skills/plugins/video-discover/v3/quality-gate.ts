/**
 * Tier 2 quality gate (CP417 independent axis).
 *
 * Tier 1 cache (`video_pool`) already enforces bronze-floor
 * (`view_count >= 1000`) at insert time (batch-video-collector).
 * Tier 2 realtime historically skipped the floor on purpose —
 * rationale: "less-viewed is better than empty slots" (executor.ts
 * pre-CP417 comment). Prod showed this let `view_count = 4` titles
 * slip through mandala-filter → visible to end user.
 *
 * This module is a pure filter; it has no side effects. Apply it
 * between the shorts/blocklist filter and the mandala-filter
 * (cell assign). Flag-controlled via `V3_ENABLE_QUALITY_GATE` so
 * pool-size A/B stays measurable against baseline.
 */

export interface QualityGateInput {
  viewCount: number | null;
  publishedDate: Date | null;
}

export interface QualityGateConfig {
  enabled: boolean;
  minViewCount: number;
  minViewsPerDay: number;
}

export interface QualityGateResult<T extends QualityGateInput> {
  kept: T[];
  droppedCount: number;
}

/**
 * Returns the subset of `items` that pass the gate. When `config.enabled`
 * is false, returns the input unchanged. When published date is unknown,
 * the item is dropped under the strict floor — unknown publish date
 * cannot yield a per-day rate, so the item is treated as zero signal.
 */
export function filterByQualityGate<T extends QualityGateInput>(
  items: T[],
  config: QualityGateConfig,
  nowMs: number = Date.now()
): QualityGateResult<T> {
  if (!config.enabled) return { kept: items, droppedCount: 0 };

  const kept: T[] = [];
  for (const item of items) {
    if (!item.publishedDate) continue;
    const view = item.viewCount ?? 0;
    if (view < config.minViewCount) continue;
    const ageMs = nowMs - item.publishedDate.getTime();
    const days = Math.max(1, ageMs / 86_400_000);
    const vpd = view / days;
    if (vpd < config.minViewsPerDay) continue;
    kept.push(item);
  }
  return { kept, droppedCount: items.length - kept.length };
}
