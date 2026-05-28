/**
 * CP489 Phase 6 — Mandala Search Journey Ledger.
 *
 * User goal (인용):
 *   "목표 - 위저드 검색 결과 - 재검색 결과 1 - 재검색 결과 2 - … 으로 이어지는
 *    하나의 큰 플로우로서, 어떻게 카드가 검색되어 사용자에게 제공되는지 전반을
 *    알 수 있는 구조. 사후 디버깅이나 검색 품질 개선을 위한 자료로도 재활용할
 *    수 있다고 생각해."
 *
 * What this module does:
 *   Joins three independent telemetry streams into one chronological journey
 *   per mandala:
 *     1. `video_discover_traces` — per-round step rows. Phase 6 expects each
 *        `add_cards.end` row's `response.returned_video_ids` to enumerate the
 *        cards that round returned (Phase 6 trace-shape addition).
 *     2. `card_interactions(signal='surfaced')` — cumulative "shown" set per
 *        mandala (written by Phase 2+3).
 *     3. `card_interactions(signal IN ('like','archive','delete'))` — user's
 *        post-surface actions on those cards.
 *
 *   Output is a `MandalaSearchJourney` — round-by-round summary + global
 *   reuse/pick stats — that powers the admin debugging surface and serves as
 *   a longitudinal quality dataset.
 *
 * Design choices:
 *   - PURE aggregator: takes already-fetched rows as inputs, returns a plain
 *     object. No I/O. Trivial to unit-test, trivial to reuse from non-route
 *     callers (e.g., quality-metrics rollups).
 *   - Round numbering is 1-based chronological per mandala — the first
 *     `add_cards.end` (or `pipeline.execute.end` wizard run) is round 1.
 *   - "Reused" = videoId present in any earlier round's `returned_video_ids`
 *     of the same mandala. Avoids relying on the surfaced-set timestamp.
 *   - User-action attribution uses `created_at` strictly after the round's
 *     `created_at` and strictly before the NEXT round's `created_at`
 *     (or +∞ for the last round). This makes "picked_after / archived_after
 *     / deleted_after" deterministic per round.
 */

export type RoundActionSignal = 'like' | 'archive' | 'delete';

export interface TraceRow {
  id: string;
  run_id: string;
  step: string;
  status: string;
  created_at: Date;
  response: unknown;
}

export interface InteractionRow {
  video_id: string;
  signal: string;
  created_at: Date;
}

export interface JourneyRound {
  round: number;
  run_id: string;
  step: string;
  ts: string; // ISO
  returned_video_ids: string[];
  fresh_video_ids: string[]; // never seen in prior rounds of this mandala
  reused_from_prior: string[]; // already returned in an earlier round
  picked_after: string[]; // signal='like' in the window after this round
  archived_after: string[];
  deleted_after: string[];
}

export interface JourneySummary {
  total_rounds: number;
  unique_shown: number;
  total_picked: number;
  total_archived: number;
  total_deleted: number;
  // Of all returned cards across rounds, what fraction were reused from a
  // prior round? 0 when every round shows brand-new cards.
  reuse_rate: number;
  // Of all unique videoIds shown, what fraction earned at least one `like`?
  picked_rate: number;
}

export interface MandalaSearchJourney {
  mandala_id: string;
  generated_at: string; // ISO
  rounds: JourneyRound[];
  summary: JourneySummary;
}

/**
 * Steps whose response.returned_video_ids enumerates the cards returned to
 * the user in that round. `add_cards.end` is the primary case. `pipeline.
 * execute.end` (wizard) would be a future addition once its trace shape
 * carries the same field.
 */
const ROUND_STEPS = new Set(['add_cards.end']);

function extractReturnedVideoIds(response: unknown): string[] {
  if (response == null || typeof response !== 'object') return [];
  const obj = response as Record<string, unknown>;
  const raw = obj['returned_video_ids'];
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v === 'string' && v.length > 0) out.push(v);
  }
  return out;
}

/**
 * Pure aggregator. Caller is responsible for filtering inputs to ONE
 * mandala — this function does not re-filter.
 *
 *   - `traces` MUST be filtered to `mandala_id = <id>` and sorted ASC by
 *     `created_at`. Rows whose `step` is not a recognised round step are
 *     ignored (so passing the full trace list verbatim is safe).
 *   - `interactions` MUST be filtered to `mandala_id = <id>` and
 *     `signal IN ('like','archive','delete')`. Order does not matter.
 */
export function buildMandalaSearchJourney(input: {
  mandalaId: string;
  traces: TraceRow[];
  interactions: InteractionRow[];
  now?: Date;
}): MandalaSearchJourney {
  const { mandalaId, traces, interactions } = input;
  const generatedAt = (input.now ?? new Date()).toISOString();

  const roundTraces = traces
    .filter((t) => ROUND_STEPS.has(t.step) && t.status === 'ok')
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());

  if (roundTraces.length === 0) {
    return {
      mandala_id: mandalaId,
      generated_at: generatedAt,
      rounds: [],
      summary: {
        total_rounds: 0,
        unique_shown: 0,
        total_picked: 0,
        total_archived: 0,
        total_deleted: 0,
        reuse_rate: 0,
        picked_rate: 0,
      },
    };
  }

  const seenAcrossRounds = new Set<string>();
  const rounds: JourneyRound[] = [];

  for (let i = 0; i < roundTraces.length; i++) {
    const row = roundTraces[i]!;
    const next = roundTraces[i + 1];
    const windowStart = row.created_at;
    const windowEnd = next ? next.created_at : null;

    const returned = extractReturnedVideoIds(row.response);
    const fresh: string[] = [];
    const reused: string[] = [];
    for (const v of returned) {
      if (seenAcrossRounds.has(v)) reused.push(v);
      else fresh.push(v);
    }
    for (const v of returned) seenAcrossRounds.add(v);

    const returnedSet = new Set(returned);
    const picked: string[] = [];
    const archived: string[] = [];
    const deleted: string[] = [];
    for (const a of interactions) {
      if (!returnedSet.has(a.video_id)) continue;
      const ts = a.created_at.getTime();
      if (ts < windowStart.getTime()) continue;
      if (windowEnd && ts >= windowEnd.getTime()) continue;
      if (a.signal === 'like') picked.push(a.video_id);
      else if (a.signal === 'archive') archived.push(a.video_id);
      else if (a.signal === 'delete') deleted.push(a.video_id);
    }

    rounds.push({
      round: i + 1,
      run_id: row.run_id,
      step: row.step,
      ts: row.created_at.toISOString(),
      returned_video_ids: returned,
      fresh_video_ids: fresh,
      reused_from_prior: reused,
      picked_after: picked,
      archived_after: archived,
      deleted_after: deleted,
    });
  }

  // Summary aggregates
  let totalReturned = 0;
  let totalReused = 0;
  for (const r of rounds) {
    totalReturned += r.returned_video_ids.length;
    totalReused += r.reused_from_prior.length;
  }

  const everPickedSet = new Set<string>();
  let totalArchived = 0;
  let totalDeleted = 0;
  for (const r of rounds) {
    for (const v of r.picked_after) everPickedSet.add(v);
    totalArchived += r.archived_after.length;
    totalDeleted += r.deleted_after.length;
  }

  const uniqueShown = seenAcrossRounds.size;
  const reuseRate = totalReturned === 0 ? 0 : totalReused / totalReturned;
  const pickedRate = uniqueShown === 0 ? 0 : everPickedSet.size / uniqueShown;

  return {
    mandala_id: mandalaId,
    generated_at: generatedAt,
    rounds,
    summary: {
      total_rounds: rounds.length,
      unique_shown: uniqueShown,
      total_picked: everPickedSet.size,
      total_archived: totalArchived,
      total_deleted: totalDeleted,
      reuse_rate: reuseRate,
      picked_rate: pickedRate,
    },
  };
}
