/**
 * auto-add-recommendations
 *
 * After video-discover populates recommendation_cache, this module places
 * the top-N recs per cell into user_video_states so the dashboard cells
 * are pre-filled when the user lands on the main view.
 *
 * Eviction policy (selective replace) — see
 * docs/design/insighta-trend-recommendation-engine.md §14:
 *
 *   ONLY rows that are unambiguously "auto-recommended and never touched"
 *   may be deleted to make room for fresh recommendations:
 *
 *     auto_added       = true
 *     user_note        IS NULL                            -- no memo
 *     is_watched       IS NULL OR false                   -- never watched
 *     watch_position_seconds IS NULL OR = 0               -- no playback
 *     is_in_ideation   = false                            -- not pinned to scratchpad
 *
 *   Any user trace (memo, watch progress, watched flag, manual scratchpad
 *   move) promotes that row to permanent — it survives every refresh.
 *   Manual rows (auto_added=false) are NEVER touched by this module.
 *
 * Slot math per cell:
 *   preserved = COUNT(rows in this cell with user trace)
 *   slots     = max(0, AUTO_ADD_PER_CELL - preserved)
 *   → INSERT up to `slots` fresh recs from recommendation_cache (top score)
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
import { AUTO_ADD_PER_CELL, VIDEO_DISCOVER_SKILL_TYPE } from '@/config/recommendations';

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

  // Group by cell_index, keep top AUTO_ADD_PER_CELL per cell.
  const recsByCell = new Map<number, typeof recs>();
  for (const r of recs) {
    if (r.cell_index == null || r.cell_index < 0 || r.cell_index >= CELLS_PER_MANDALA) {
      continue;
    }
    const list = recsByCell.get(r.cell_index) ?? [];
    if (list.length < AUTO_ADD_PER_CELL) {
      list.push(r);
      recsByCell.set(r.cell_index, list);
    }
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
        user_note: null,
        is_watched: false,
        watch_position_seconds: 0,
        is_in_ideation: false,
      },
    });

    totalPreserved += preservedCount;
    totalDeleted += deleted.count;

    const slots = Math.max(0, AUTO_ADD_PER_CELL - preservedCount);
    if (slots === 0) continue;

    // Skip recs whose video already exists in user_video_states for this
    // user (e.g. preserved rows whose video_id collides with top recs).
    // Without this filter, an upsert would hit the unique constraint and
    // run UPDATE, silently consuming a slot without adding a new row.
    const allRecsForCell = recsByCell.get(cellIndex) ?? [];
    const candidateVideoIds = allRecsForCell.map((r) => r.video_id);
    const existingYtRecords =
      candidateVideoIds.length > 0
        ? await db.youtube_videos.findMany({
            where: {
              youtube_video_id: { in: candidateVideoIds },
              userState: { some: { user_id: userId } },
            },
            select: { youtube_video_id: true },
          })
        : [];
    const existingVideoIdSet = new Set(existingYtRecords.map((r) => r.youtube_video_id));

    const cellRecs = allRecsForCell
      .filter((r) => !existingVideoIdSet.has(r.video_id))
      .slice(0, slots);
    if (cellRecs.length === 0) continue;

    for (let i = 0; i < cellRecs.length; i++) {
      const rec = cellRecs[i];
      if (!rec) continue;

      try {
        // Upsert the youtube_videos row first (recommendation_cache stores
        // the YouTube video id as varchar; user_video_states needs the
        // youtube_videos.id UUID FK).
        const ytVideo = await db.youtube_videos.upsert({
          where: { youtube_video_id: rec.video_id },
          create: {
            youtube_video_id: rec.video_id,
            title: rec.title,
            thumbnail_url: rec.thumbnail,
            channel_title: rec.channel,
            duration_seconds: rec.duration_sec,
          },
          update: {
            title: rec.title,
            thumbnail_url: rec.thumbnail,
            channel_title: rec.channel,
            duration_seconds: rec.duration_sec,
          },
          select: { id: true },
        });

        // Upsert user_video_state for this user × video. If the user already
        // has any state row for this video (e.g. saw it manually before),
        // we update mandala/cell/level binding but DO NOT clobber user_note,
        // is_watched, or watch_position_seconds.
        await db.userVideoState.upsert({
          where: {
            user_id_videoId: {
              user_id: userId,
              videoId: ytVideo.id,
            },
          },
          create: {
            user_id: userId,
            videoId: ytVideo.id,
            mandala_id: mandalaId,
            cell_index: cellIndex,
            level_id: ROOT_LEVEL_ID,
            is_in_ideation: false,
            sort_order: i,
            auto_added: true,
          },
          update: {
            // Do not touch user_note / is_watched / watch_position_seconds.
            mandala_id: mandalaId,
            cell_index: cellIndex,
            level_id: ROOT_LEVEL_ID,
            sort_order: i,
            // Don't downgrade an already-manual row to auto.
            // (auto_added stays whatever it was.)
          },
        });

        totalInserted += 1;
      } catch (err) {
        log.warn(
          `auto-add upsert failed for video=${rec.video_id} cell=${cellIndex}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
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

  return {
    ok: true,
    cellsProcessed: CELLS_PER_MANDALA,
    rowsPreserved: totalPreserved,
    rowsDeleted: totalDeleted,
    rowsInserted: totalInserted,
  };
}
