/**
 * Admin Pool Health dashboard thresholds.
 *
 * Each metric exposes a band {ok, warn, direction}. The dashboard maps
 * the live value to 'ok' | 'warn' | 'critical' via `evaluateHealth`.
 * Defaults are chosen from the 2026-05-30 prod baseline measurement and
 * are intentionally exported as plain constants so they can be edited in
 * one place when policy changes (no env knob — these are not secrets and
 * not per-deploy tunables).
 */

export type HealthDirection = 'higher_is_better' | 'lower_is_better';

export interface HealthBand {
  readonly ok: number;
  readonly warn: number;
  readonly direction: HealthDirection;
  readonly unit: '%' | 'count' | 'ratio' | 'days';
  readonly label: string;
  /**
   * Optional kill-switch. When `false`, the metric is shown but its status
   * is forced to 'na' (gray) regardless of value. Used for measurements
   * that are structurally not meaningful yet — e.g. pre-launch user
   * inflow share where N=0 users makes 0% the correct steady state, not
   * an error. Flip to `true` (or remove the field) once the signal turns
   * on. Defaults to `true` if omitted.
   */
  readonly enabled?: boolean;
}

export const POOL_HEALTH_THRESHOLDS = {
  volumeDailyAvg30d: {
    ok: 100,
    warn: 30,
    direction: 'higher_is_better',
    unit: 'count',
    label: 'Avg daily inflow (30d)',
  },
  blankDays30d: {
    ok: 2,
    warn: 5,
    direction: 'lower_is_better',
    unit: 'days',
    label: 'Blank inflow days (30d)',
  },
  // 2026-05-30 diagnosis: video_summaries (V1, deprecated) was 33.3%
  // covered but 98.7% of those rows are model='metadata-enriched' (no
  // LLM call) — measurement was structurally wrong. The real enrich
  // pipeline writes to video_rich_summaries. Both metrics are surfaced
  // separately so the v1 → v2 transition stays observable.
  richSummaryV1Pct: {
    ok: 50,
    warn: 30,
    direction: 'higher_is_better',
    unit: '%',
    label: 'V1 video_summaries coverage (legacy)',
  },
  richSummaryV1LlmPct: {
    ok: 30,
    warn: 5,
    direction: 'higher_is_better',
    unit: '%',
    label: 'V1 LLM-authored share (excl. metadata fallback)',
  },
  richSummaryV2Pct: {
    ok: 80,
    warn: 50,
    direction: 'higher_is_better',
    unit: '%',
    label: 'V2 video_rich_summaries pass coverage',
  },
  embeddingPct: {
    ok: 95,
    warn: 80,
    direction: 'higher_is_better',
    unit: '%',
    label: 'Embedding coverage',
  },
  // CC bulk pipeline health — Mac Mini /transcript/candidates path.
  // Caption fail = transcript_attempted_at stamped but the video has no
  // v2 row with quality_flag='pass'. Two known root causes mix here
  // (yt-dlp/WebShare proxy block + BSD-vs-gawk parsing) — split would
  // require Mac Mini log shipping, future work.
  captionFailRate7d: {
    ok: 24,
    warn: 50,
    direction: 'lower_is_better',
    unit: '%',
    label: 'Caption fail rate (last 7d)',
  },
  // Hours since the last Mac Mini bulk-pipeline pulse. Proxy =
  // max(youtube_videos.transcript_attempted_at) — every Mac Mini
  // process-one.sh exit path stamps this. > 6h = scheduler likely stuck.
  lastBulkFireHours: {
    ok: 2,
    warn: 6,
    direction: 'lower_is_better',
    unit: 'days',
    label: 'Hours since last bulk fire',
  },
  userInflowPct: {
    ok: 5,
    warn: 1,
    direction: 'higher_is_better',
    unit: '%',
    label: 'User inflow share (video_pool)',
    // Pre-launch: 0 users means 0% is the structurally correct value, so
    // CRITICAL would be a permanent false alarm (alarm fatigue). Flip to
    // `true` once launch fills the user_curated / user_playlist / user_add
    // funnel. The raw value is still computed and displayed; only the
    // status badge is suppressed.
    enabled: false,
  },
  nullSourcePct: {
    ok: 10,
    warn: 30,
    direction: 'lower_is_better',
    unit: '%',
    label: 'NULL/legacy source share',
  },
  avgReusePerVideo: {
    ok: 1.3,
    warn: 1.8,
    direction: 'lower_is_better',
    unit: 'ratio',
    label: 'Avg reuse per video (30d)',
  },
  reuse2PlusMandalaPct: {
    ok: 10,
    warn: 20,
    direction: 'lower_is_better',
    unit: '%',
    label: 'Videos in 2+ mandalas (30d)',
  },
  promotePct: {
    ok: 50,
    warn: 30,
    direction: 'higher_is_better',
    unit: '%',
    label: 'Recs → auto_added promote %',
  },
} as const satisfies Record<string, HealthBand>;

export type PoolHealthMetricKey = keyof typeof POOL_HEALTH_THRESHOLDS;

export type HealthStatus = 'ok' | 'warn' | 'critical' | 'na';

export function evaluateHealth(value: number, band: HealthBand): HealthStatus {
  if (band.enabled === false) return 'na';
  if (!Number.isFinite(value)) return 'critical';
  if (band.direction === 'higher_is_better') {
    if (value >= band.ok) return 'ok';
    if (value >= band.warn) return 'warn';
    return 'critical';
  }
  if (value <= band.ok) return 'ok';
  if (value <= band.warn) return 'warn';
  return 'critical';
}

/**
 * Out-of-scope known issues surfaced on the dashboard as a static "Known
 * Issues" banner. Listed here so the FE can render them without hard-coding
 * the text and so the next /retro can track when they get resolved.
 */
export const POOL_HEALTH_KNOWN_ISSUES: ReadonlyArray<{ id: string; text: string }> = [
  {
    id: 'v1-metadata-fallback',
    text: 'V1 video_summaries — 98.7% metadata-enriched (LLM 안 거친 fallback). 실 enrich 측정은 richSummaryV2Pct.',
  },
  {
    id: 'v2-cron-disabled',
    text: 'RICH_SUMMARY_V2_CRON_ENABLED=false (prod). V2 backfill 은 Mac Mini bulk path (claude-code-direct).',
  },
  {
    id: 'caption-fail-mixed-cause',
    text: 'Caption fail = (yt-dlp WebShare proxy block) + (BSD-vs-gawk parsing). awk fail 만 gawk 로 fix 완료 (2026-05-30).',
  },
  {
    id: 'surfaced-at-dead',
    text: 'recommendation_cache.surfaced_at 항상 NULL (CP488 backlog 미작동)',
  },
  {
    id: 'source-null-legacy',
    text: 'youtube_videos.source NULL/legacy 비중 43% (collector 일부 경로 미식별)',
  },
  {
    id: 'user-inflow-pre-launch',
    text: 'User inflow share — pre-launch (0 users), 헬스 등급 비활성 (POOL_HEALTH_THRESHOLDS.userInflowPct.enabled=false). launch 후 활성화.',
  },
];

/**
 * Snapshot file path — disk fallback when live SQL fails (e.g. DB blip).
 * Default lives outside the app dir so a container rebuild does not wipe
 * the last-good snapshot. Override via env when needed (test/CI).
 */
export function getPoolHealthSnapshotPath(env: NodeJS.ProcessEnv = process.env): string {
  return env['POOL_HEALTH_SNAPSHOT_PATH'] || '/var/insighta/pool-health-snapshot.json';
}

export const POOL_HEALTH_CACHE_TTL_MS = 5 * 60 * 1000;
