/**
 * auto-add-recommendations
 *
 * After video-discover populates recommendation_cache, this module places
 * ALL fresh recommendations per cell into user_video_states so the dashboard
 * cells are pre-filled when the user lands on the main view. The upstream
 * video-discover pipeline already enforces per-cell/total caps
 * (mandala-filter + V3_TARGET_PER_CELL + V3_TARGET_TOTAL); any cap applied
 * here would be a second, uncoordinated trim that shrinks cells which legit
 * have 4–8 candidates.
 *
 * History:
 *   - CP357: introduced with an `AUTO_ADD_PER_CELL = 3` hard cap.
 *   - 2026-04-18: user report surfaced that the cap caused "14 장" to appear
 *     for a mandala whose recommendation_cache had 40 rows. The cap was
 *     removed per product direction ("최종 필터를 통해서 추천되는 것이 맞아").
 *     Preservation of user-touched rows remains unchanged — those rows
 *     still survive every refresh.
 *
 * Eviction policy (selective replace) — see
 * docs/design/insighta-trend-recommendation-engine.md §14:
 *
 *   ONLY rows that are unambiguously "auto-recommended and never touched"
 *   may be deleted to make room for fresh recommendations:
 *
 *     auto_added       = true
 *     pinned_at        IS NULL                            -- not bookmarked
 *     user_note        IS NULL                            -- no memo
 *     is_watched       IS NULL OR false                   -- never watched
 *     watch_position_seconds IS NULL OR = 0               -- no playback
 *     is_in_ideation   = false                            -- not pinned to scratchpad
 *
 *   Any user trace (bookmark, memo, watch progress, watched flag, manual
 *   scratchpad move) promotes that row to permanent — it survives every
 *   refresh.
 *   Manual rows (auto_added=false) are NEVER touched by this module.
 *
 * Insert per cell (post-2026-04-18):
 *   → DELETE untouched auto_added rows in the cell
 *   → INSERT every rec from recommendation_cache for the cell, minus those
 *     whose video_id is already linked to this user's youtube_videos
 *     (dedup — otherwise upsert silently consumes the unique constraint
 *     without producing a fresh row)
 *
 * Idempotency: relies on UserVideoState's @@unique([user_id, videoId]).
 * Re-running on the same recommendation_cache produces no duplicates.
 *
 * Trigger sites:
 *   - mandala-post-creation.ts runVideoDiscover() success path
 *   - PATCH /api/v1/mandalas/:id/skills (video_discover ON toggle, via the
 *     same triggerMandalaPostCreationAsync chain) — backfills existing mandalas
 */

import { getPrismaClient } from '@/modules/database';
import { logger } from '@/utils/logger';
import {
  VIDEO_DISCOVER_SKILL_TYPE,
  loadAutoAddGuardConfig,
  passesViewCountGate,
} from '@/config/recommendations';
import { notifyCardAdded, type CardPayload } from '@/modules/recommendations/publisher';
import { recordTrace } from '@/modules/discover-tracing';
import { collectAndUpsertMetadata } from '@/modules/youtube/metadata-collector';

const log = logger.child({ module: 'auto-add-recommendations' });

/** level_id used for root-level (depth=0) auto-added cards. */
const ROOT_LEVEL_ID = 'root';
/** Total cells per mandala root level (3x3 with center excluded). */
const CELLS_PER_MANDALA = 8;

interface AutoAddResult {
  ok: boolean;
  reason?: string;
  cellsProcessed?: number;
  rowsPreserved?: number;
  rowsDeleted?: number;
  rowsInserted?: number;
}

/**
 * Run auto-add for one (user, mandala) pair. Idempotent and safe to call
 * after every video-discover execution.
 *
 * Returns ok=false with a reason when auto_add is opted out, no recs exist,
 * or no recommendation_cache rows are pending. Never throws — failures are
 * logged and surfaced via the result object.
 */
export async function maybeAutoAddRecommendations(
  userId: string,
  mandalaId: string
): Promise<AutoAddResult> {
  const db = getPrismaClient();
  const t0 = Date.now();

  // Opt-in gate: read auto_add from user_skill_config.config JSONB.
  // Default ON when row exists with enabled=true (the wizard fallback
  // populates config={auto_add:true}); silently skip when skill is disabled.
  const cfg = await db.user_skill_config.findFirst({
    where: {
      user_id: userId,
      mandala_id: mandalaId,
      skill_type: VIDEO_DISCOVER_SKILL_TYPE,
    },
    select: { enabled: true, config: true },
  });

  if (!cfg?.enabled) {
    return { ok: false, reason: 'video_discover skill not enabled' };
  }

  const cfgObj = (cfg.config ?? {}) as Record<string, unknown>;
  const autoAdd = typeof cfgObj['auto_add'] === 'boolean' ? (cfgObj['auto_add'] as boolean) : true;
  if (!autoAdd) {
    return { ok: false, reason: 'auto_add disabled in skill config' };
  }

  // Pull all pending recs for this mandala (cell-bound only — drop nulls).
  const recs = await db.recommendation_cache.findMany({
    where: {
      user_id: userId,
      mandala_id: mandalaId,
      status: 'pending',
      expires_at: { gt: new Date() },
      cell_index: { not: null },
    },
    orderBy: [{ cell_index: 'asc' }, { rec_score: 'desc' }],
  });

  if (recs.length === 0) {
    return { ok: false, reason: 'no pending recommendation_cache rows' };
  }

  // Chokepoint guards (CP500+): view-count floor + metadata enrich. Both
  // default no-op (env unset). This is the single confluence ALL automatic
  // inflow passes through (live/pool/wizard) — see loadAutoAddGuardConfig.
  const guard = loadAutoAddGuardConfig();

  // Group by cell_index. No per-cell cap (2026-04-18): the upstream
  // pipeline already sets V3_TARGET_PER_CELL / V3_TARGET_TOTAL, so every
  // row surfaced here is already filter-approved.
  const recsByCell = new Map<number, typeof recs>();
  for (const r of recs) {
    if (r.cell_index == null || r.cell_index < 0 || r.cell_index >= CELLS_PER_MANDALA) {
      continue;
    }
    const list = recsByCell.get(r.cell_index) ?? [];
    list.push(r);
    recsByCell.set(r.cell_index, list);
  }

  let totalPreserved = 0;
  let totalDeleted = 0;
  let totalInserted = 0;

  for (let cellIndex = 0; cellIndex < CELLS_PER_MANDALA; cellIndex++) {
    // Selective replace: count user-trace rows in this cell, then delete
    // only the un-touched auto_added rows. ANY trace = preserved forever.
    const preservedCount = await db.userVideoState.count({
      where: {
        user_id: userId,
        mandala_id: mandalaId,
        cell_index: cellIndex,
        auto_added: true,
        OR: [
          { pinned_at: { not: null } },
          { user_note: { not: null } },
          { is_watched: true },
          { watch_position_seconds: { gt: 0 } },
          { is_in_ideation: true },
        ],
      },
    });

    const deleted = await db.userVideoState.deleteMany({
      where: {
        user_id: userId,
        mandala_id: mandalaId,
        cell_index: cellIndex,
        auto_added: true,
        pinned_at: null,
        user_note: null,
        is_watched: false,
        watch_position_seconds: 0,
        is_in_ideation: false,
      },
    });

    totalPreserved += preservedCount;
    totalDeleted += deleted.count;

    const allRecsForCell = recsByCell.get(cellIndex) ?? [];
    if (allRecsForCell.length === 0) continue;

    // Skip recs whose video already exists in user_video_states for this
    // user (e.g. preserved rows whose video_id collides with incoming recs).
    // Without this filter, an upsert would hit the unique constraint and
    // run UPDATE, silently producing an apparent-add without a new row.
    const candidateVideoIds = allRecsForCell.map((r) => r.video_id);
    const existingYtRecords = await db.youtube_videos.findMany({
      where: {
        youtube_video_id: { in: candidateVideoIds },
        userState: { some: { user_id: userId } },
      },
      select: { youtube_video_id: true },
    });
    const existingVideoIdSet = new Set(existingYtRecords.map((r) => r.youtube_video_id));

    const cellRecs = allRecsForCell.filter((r) => !existingVideoIdSet.has(r.video_id));
    if (cellRecs.length === 0) continue;

    // ─────────────────────────────────────────────────────────────────────────
    // 2026-05-13 bulk INSERT refactor (Phase D pipeline speedup):
    //
    // Prior: cellRecs.map → Promise.all of {youtube_videos.upsert, userVideoState.upsert}
    //   = 2 sequential Prisma roundtrips per card × 51 cards = 102 roundtrips.
    //   At pgbouncer ~65ms latency: ~6.6s in step 3 alone (measured 8.2s with
    //   per-cell fixed overhead).
    //
    // Now: 3 bulk Prisma roundtrips per cell, regardless of card count:
    //   (a) findMany existing youtube_videos by video_id → know which already
    //       have a Postgres id (legacy rows from prior runs).
    //   (b) createMany new youtube_videos (skipDuplicates) — youtube_videos
    //       holds unique (youtube_video_id) so concurrent runs won't collide.
    //   (c) findMany ALL ids (existing + just-created) → build video_id→id map.
    //   (d) createMany userVideoState rows (skipDuplicates on unique(user_id,
    //       videoId)) — single SQL batch insert.
    //
    // notifyCardAdded fires per row from the cell loop body after the batch
    // completes, preserving SSE behaviour bit-identically.
    //
    // Trade-off vs upsert: createMany cannot UPDATE existing rows. The prior
    // upsert UPDATE branch (auto-add re-running) updated mandala_id /
    // cell_index / sort_order on an already-userVideoState row. That branch
    // is now skipped — re-running auto-add on a userVideoState row will
    // leave the prior mandala_id intact. Acceptable: the explicit dedup at
    // line 184 (`existingYtRecords ... userState`) already filters
    // already-linked rows out of cellRecs, so re-add is a no-op anyway.
    // ─────────────────────────────────────────────────────────────────────────
    const cellVideoIds = cellRecs.map((r) => r.video_id);

    // (a) Look up existing youtube_videos for this cell's recs. metadata_fetched_at
    //     drives enrich-scoping below (only enrich rows that lack authoritative meta).
    const existingYt = await db.youtube_videos.findMany({
      where: { youtube_video_id: { in: cellVideoIds } },
      select: { id: true, youtube_video_id: true, metadata_fetched_at: true },
    });
    const existingYtMap = new Map(existingYt.map((y) => [y.youtube_video_id, y.id]));
    const existingMetaNull = new Set(
      existingYt.filter((y) => y.metadata_fetched_at == null).map((y) => y.youtube_video_id)
    );

    // (b) createMany for new youtube_videos only (skipDuplicates handles races).
    const newYtRows = cellRecs
      .filter((r) => !existingYtMap.has(r.video_id))
      .map((r) => {
        const publishedAt = r.published_at ? new Date(r.published_at) : null;
        const viewCount =
          typeof r.view_count === 'number' && Number.isFinite(r.view_count)
            ? BigInt(Math.max(0, Math.trunc(r.view_count)))
            : null;
        const likeCount =
          r.like_ratio != null && r.view_count != null
            ? BigInt(Math.max(0, Math.round(r.view_count * r.like_ratio)))
            : null;
        return {
          youtube_video_id: r.video_id,
          title: r.title,
          thumbnail_url: r.thumbnail,
          channel_title: r.channel,
          duration_seconds: r.duration_sec,
          view_count: viewCount,
          like_count: likeCount,
          published_at: publishedAt,
        };
      });
    if (newYtRows.length > 0) {
      try {
        await db.youtube_videos.createMany({
          data: newYtRows,
          skipDuplicates: true,
        });
      } catch (err) {
        log.warn(
          `auto-add bulk youtube_videos.createMany failed (cell=${cellIndex}): ${err instanceof Error ? err.message : String(err)}`
        );
        // Continue — partial pool still works via existing rows below.
      }
    }

    // Meta enrich (chokepoint guard ②): now that the youtube_videos rows exist
    // (createMany above), fill authoritative view_count/published_at/
    // metadata_fetched_at so the view gate decides on real counts, not sparse
    // search-snippet data. UPDATE-only (metadata-collector:73) → must run AFTER
    // row creation. Idempotent + fail-open: a failure leaves view_count null
    // and the gate passes the card (re-evaluated on the next refresh once
    // enrichment succeeds, or by the nightly metadata cron backstop).
    if (guard.metaEnrich) {
      const idsToEnrich = cellVideoIds.filter(
        (vid) => !existingYtMap.has(vid) || existingMetaNull.has(vid)
      );
      if (idsToEnrich.length > 0) {
        try {
          await collectAndUpsertMetadata(idsToEnrich);
        } catch (err) {
          log.warn(
            `auto-add meta-enrich failed (cell=${cellIndex}, n=${idsToEnrich.length}): ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }
    }

    // (c) Re-fetch full id map so we can build userVideoState rows. view_count
    //     is the authoritative value (post-enrich) the gate below reads.
    const allYt = await db.youtube_videos.findMany({
      where: { youtube_video_id: { in: cellVideoIds } },
      select: { id: true, youtube_video_id: true, view_count: true },
    });
    const ytIdByVideoId = new Map(allYt.map((y) => [y.youtube_video_id, y.id]));
    const viewByVideoId = new Map(allYt.map((y) => [y.youtube_video_id, y.view_count]));

    // View gate (chokepoint guard ①): drop ultra-low-view garbage from the
    // AUTO path. Pure filter on insert candidates — issues NO delete and
    // operates on cellRecs, which already excludes videos linked to this user
    // (dedup at existingVideoIdSet above). So user-touched cards are never seen
    // by the gate → immutable. fail-open on null view; min<=0 = no-op (default).
    const survivingRecs = cellRecs.filter((r) =>
      passesViewCountGate(viewByVideoId.get(r.video_id), guard.minViewCount)
    );
    if (survivingRecs.length === 0) continue;

    // (d) createMany userVideoState. skipDuplicates handles concurrent re-runs
    //     hitting unique(user_id, videoId). Built from survivingRecs so gated
    //     (ultra-low-view) candidates never materialize a card.
    const uvsRows = survivingRecs
      .map((r, i) => {
        const videoId = ytIdByVideoId.get(r.video_id);
        if (!videoId) return null;
        return {
          user_id: userId,
          videoId,
          mandala_id: mandalaId,
          cell_index: cellIndex,
          level_id: ROOT_LEVEL_ID,
          is_in_ideation: false,
          sort_order: i,
          auto_added: true,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    let insertedInThisCell = 0;
    if (uvsRows.length > 0) {
      try {
        const createRes = await db.userVideoState.createMany({
          data: uvsRows,
          skipDuplicates: true,
        });
        insertedInThisCell = createRes.count;
      } catch (err) {
        log.warn(
          `auto-add bulk userVideoState.createMany failed (cell=${cellIndex}): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }

    // SSE: fire notifyCardAdded for each rec the batch touched. Iterate
    // survivingRecs only — gated candidates have no uvs row, so emitting an
    // event for them would surface a phantom card. notifyCardAdded is an
    // in-process EventEmitter — non-blocking.
    for (let i = 0; i < survivingRecs.length; i++) {
      const rec = survivingRecs[i];
      if (!rec) continue;
      try {
        const payload: CardPayload = {
          id: rec.id,
          videoId: rec.video_id,
          title: rec.title,
          channel: rec.channel,
          thumbnail: rec.thumbnail,
          durationSec: rec.duration_sec,
          recScore: rec.rec_score,
          cellIndex,
          cellLabel: null,
          keyword: rec.keyword ?? '',
          source: rec.weight_version === 0 ? 'manual' : 'auto_recommend',
          recReason: rec.rec_reason,
          publishedAt: rec.published_at?.toISOString() ?? null,
          // PR3 (#614) — anchor lookup deferred to SSE backlog path
          // (see GET /api/v1/mandalas/:id and SSE handler in mandalas.ts).
          startSec: null,
        };
        notifyCardAdded(mandalaId, payload);
      } catch (notifyErr) {
        log.warn(
          `auto-add notifyCardAdded failed for video=${rec.video_id}: ${
            notifyErr instanceof Error ? notifyErr.message : String(notifyErr)
          }`
        );
      }
    }
    totalInserted += insertedInThisCell;
  }

  // Mark the consumed recommendation_cache rows as 'shown' so future
  // refreshes can re-prioritize. Idempotent — already-shown rows won't
  // re-flow through this loop because we filter status='pending' above.
  if (totalInserted > 0) {
    await db.recommendation_cache.updateMany({
      where: {
        user_id: userId,
        mandala_id: mandalaId,
        status: 'pending',
        cell_index: { not: null },
      },
      data: { status: 'shown' },
    });
  }

  log.info(
    `auto-add complete user=${userId} mandala=${mandalaId} cells=${CELLS_PER_MANDALA} preserved=${totalPreserved} deleted=${totalDeleted} inserted=${totalInserted}`
  );

  // CP457+ trace — auto-add → user_video_states summary. Caller's trace
  // context (mandalaId/userId/runId) propagates here via AsyncLocalStorage.
  recordTrace({
    step: 'auto_add.user_video_states',
    status: 'ok',
    request: { mandalaId, userId, cellsExamined: CELLS_PER_MANDALA },
    response: {
      rowsPreserved: totalPreserved,
      rowsDeleted: totalDeleted,
      rowsInserted: totalInserted,
    },
    latencyMs: Date.now() - t0,
  });

  return {
    ok: true,
    cellsProcessed: CELLS_PER_MANDALA,
    rowsPreserved: totalPreserved,
    rowsDeleted: totalDeleted,
    rowsInserted: totalInserted,
  };
}
