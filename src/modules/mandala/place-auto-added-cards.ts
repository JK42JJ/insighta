/**
 * placeAutoAddedCards — THE single chokepoint for placing `auto_added=true`
 * cards into user_video_states (CP500++ PR-2, INV-CHOKEPOINT-ENFORCED).
 *
 * Extracted verbatim from auto-add-recommendations.ts's per-cell placement so
 * BOTH the auto-add pipeline AND pool-serve route every system-discovery card
 * through ONE function. The auto-add caller's behaviour is byte-preserved
 * (same dedup → youtube_videos ensure → meta-enrich → view-gate → uvs
 * createMany → notify, same order); the per-caller knobs (notify / sort_order /
 * view-gate / relevance_pct) toggle the small auto-add-vs-pool-serve diffs.
 *
 * Boundary (audit phase-2): DISCOVERY auto-inflow ONLY (auto_added=true).
 * User-action placements (like/pin = auto_added:false) and non-discovery
 * (playlist sync / watch-state / manual D&D) do NOT pass here and are NOT the
 * lint's target — see scripts/ci/check-card-chokepoint.sh.
 *
 * Caller owns selective-replace (delete of un-touched auto_added rows) and any
 * per-cell capping BEFORE calling this — the primitive is pure placement.
 */
import type { PrismaClient } from '@prisma/client';
import { passesViewCountGate } from '@/config/recommendations';
import { notifyCardAdded, type CardPayload } from '@/modules/recommendations/publisher';
import { collectAndUpsertMetadata } from '@/modules/youtube/metadata-collector';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'place-auto-added-cards' });

/** level_id used for root-level (depth=0) auto-added cards. */
const ROOT_LEVEL_ID = 'root';

/** One placeable discovery candidate (auto-add rec OR pool-serve gate result). */
export interface PlaceableCandidate {
  /** 11-char YouTube id (youtube_videos.youtube_video_id). */
  videoId: string;
  title: string;
  /** Optional youtube_videos.description (pool-serve carries it; auto-add null). */
  description?: string | null;
  thumbnail: string | null;
  channelTitle: string | null;
  durationSec: number | null;
  /** Search-snippet or pool view_count (authoritative filled by meta-enrich). */
  viewCount: number | null;
  publishedAt: Date | null;
  /** like_count = round(viewCount * likeRatio) when both present. */
  likeRatio?: number | null;
  /** Copied to uvs.relevance_pct on insert (pool-serve gate score). null = none. */
  relevancePct?: number | null;
  /** SSE payload extras (only read when options.notify). */
  recId?: string;
  recScore?: number | null;
  keyword?: string | null;
  recReason?: string | null;
  source?: CardPayload['source'];
}

export interface PlaceOptions {
  /** Apply the #922 view-count floor. Default false (no gate). */
  applyViewGate?: boolean;
  /** Floor for the view gate; <=0 = pass-all (passesViewCountGate). */
  minViewCount?: number;
  /** Run authoritative metadata enrich before the view gate (auto-add guard). */
  metaEnrich?: boolean;
  /** Fire notifyCardAdded SSE per placed card (auto-add path). */
  notify?: boolean;
  /** Stamp sort_order = placement index (auto-add path). */
  setSortOrder?: boolean;
}

export interface PlaceResult {
  inserted: number;
}

/**
 * Place a cell's worth of DISCOVERY candidates as auto_added=true uvs rows.
 * Dedup-safe (skips videos already linked to the user). Never throws on the
 * bulk inserts (logs + continues). Returns the number of rows inserted.
 */
export async function placeAutoAddedCards(
  db: PrismaClient,
  userId: string,
  mandalaId: string,
  cellIndex: number,
  candidates: PlaceableCandidate[],
  options: PlaceOptions = {}
): Promise<PlaceResult> {
  if (candidates.length === 0) return { inserted: 0 };

  // Dedup: skip videos already linked to this user's uvs — otherwise the
  // unique(user_id, videoId) constraint turns the insert into a silent UPDATE
  // (apparent-add without a fresh row). User-touched cards are filtered here so
  // the gate/insert below never sees them → immutable.
  const candidateVideoIds = candidates.map((c) => c.videoId);
  const existingYtRecords = await db.youtube_videos.findMany({
    where: {
      youtube_video_id: { in: candidateVideoIds },
      userState: { some: { user_id: userId } },
    },
    select: { youtube_video_id: true },
  });
  const existingVideoIdSet = new Set(existingYtRecords.map((r) => r.youtube_video_id));
  const cellRecs = candidates.filter((c) => !existingVideoIdSet.has(c.videoId));
  if (cellRecs.length === 0) return { inserted: 0 };

  const cellVideoIds = cellRecs.map((c) => c.videoId);

  // (a) existing youtube_videos for these recs (id + meta-null for enrich scope).
  const existingYt = await db.youtube_videos.findMany({
    where: { youtube_video_id: { in: cellVideoIds } },
    select: { id: true, youtube_video_id: true, metadata_fetched_at: true },
  });
  const existingYtMap = new Map(existingYt.map((y) => [y.youtube_video_id, y.id]));
  const existingMetaNull = new Set(
    existingYt.filter((y) => y.metadata_fetched_at == null).map((y) => y.youtube_video_id)
  );

  // (b) createMany new youtube_videos only (skipDuplicates handles races).
  const newYtRows = cellRecs
    .filter((c) => !existingYtMap.has(c.videoId))
    .map((c) => {
      const viewCount =
        typeof c.viewCount === 'number' && Number.isFinite(c.viewCount)
          ? BigInt(Math.max(0, Math.trunc(c.viewCount)))
          : null;
      const likeCount =
        c.likeRatio != null && c.viewCount != null
          ? BigInt(Math.max(0, Math.round(c.viewCount * c.likeRatio)))
          : null;
      return {
        youtube_video_id: c.videoId,
        title: c.title,
        description: c.description ?? null,
        thumbnail_url: c.thumbnail,
        channel_title: c.channelTitle,
        duration_seconds: c.durationSec,
        view_count: viewCount,
        like_count: likeCount,
        published_at: c.publishedAt,
      };
    });
  if (newYtRows.length > 0) {
    try {
      await db.youtube_videos.createMany({ data: newYtRows, skipDuplicates: true });
    } catch (err) {
      log.warn(
        `placeAutoAddedCards youtube_videos.createMany failed (cell=${cellIndex}): ${err instanceof Error ? err.message : String(err)}`
      );
      // Continue — partial pool still works via existing rows below.
    }
  }

  // Meta enrich (optional, #922 guard ②): now that the rows exist, fill
  // authoritative view_count/published_at/metadata_fetched_at so the view gate
  // decides on real counts. UPDATE-only → must run AFTER row creation.
  // Idempotent + fail-open.
  if (options.metaEnrich) {
    const idsToEnrich = cellVideoIds.filter(
      (vid) => !existingYtMap.has(vid) || existingMetaNull.has(vid)
    );
    if (idsToEnrich.length > 0) {
      try {
        await collectAndUpsertMetadata(idsToEnrich);
      } catch (err) {
        log.warn(
          `placeAutoAddedCards meta-enrich failed (cell=${cellIndex}, n=${idsToEnrich.length}): ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  // (c) re-fetch full id map + authoritative view_count (post-enrich).
  const allYt = await db.youtube_videos.findMany({
    where: { youtube_video_id: { in: cellVideoIds } },
    select: { id: true, youtube_video_id: true, view_count: true },
  });
  const ytIdByVideoId = new Map(allYt.map((y) => [y.youtube_video_id, y.id]));
  const viewByVideoId = new Map(allYt.map((y) => [y.youtube_video_id, y.view_count]));

  // View gate (optional, #922 guard ①): drop ultra-low-view garbage. Pure
  // filter; fail-open on null view; min<=0 = no-op (default).
  const survivingRecs = options.applyViewGate
    ? cellRecs.filter((c) =>
        passesViewCountGate(viewByVideoId.get(c.videoId), options.minViewCount ?? 0)
      )
    : cellRecs;
  if (survivingRecs.length === 0) return { inserted: 0 };

  // (d) createMany userVideoState. ★The ONLY auto_added:true INSERT site.★
  // skipDuplicates handles concurrent re-runs hitting unique(user_id, videoId).
  const now = new Date();
  const uvsRows = survivingRecs
    .map((c, i) => {
      const videoId = ytIdByVideoId.get(c.videoId);
      if (!videoId) return null;
      const row: {
        user_id: string;
        videoId: string;
        mandala_id: string;
        cell_index: number;
        level_id: string;
        is_in_ideation: boolean;
        auto_added: true;
        sort_order?: number;
        relevance_pct?: number;
        relevance_at?: Date;
      } = {
        user_id: userId,
        videoId,
        mandala_id: mandalaId,
        cell_index: cellIndex,
        level_id: ROOT_LEVEL_ID,
        is_in_ideation: false,
        auto_added: true,
      };
      if (options.setSortOrder) row.sort_order = i;
      if (c.relevancePct != null) {
        row.relevance_pct = c.relevancePct;
        row.relevance_at = now;
      }
      return row;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  let inserted = 0;
  if (uvsRows.length > 0) {
    try {
      const createRes = await db.userVideoState.createMany({
        data: uvsRows,
        skipDuplicates: true,
      });
      inserted = createRes.count;
    } catch (err) {
      log.warn(
        `placeAutoAddedCards userVideoState.createMany failed (cell=${cellIndex}): ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // SSE: fire notifyCardAdded for each surviving rec (optional — auto-add path;
  // pool-serve drives its FE state via skill_runs instead). Gated candidates
  // have no uvs row, so iterating survivingRecs avoids phantom cards.
  if (options.notify) {
    for (const c of survivingRecs) {
      try {
        const payload: CardPayload = {
          id: c.recId ?? c.videoId,
          videoId: c.videoId,
          title: c.title,
          channel: c.channelTitle,
          thumbnail: c.thumbnail,
          durationSec: c.durationSec,
          recScore: c.recScore ?? 0,
          cellIndex,
          cellLabel: null,
          keyword: c.keyword ?? '',
          source: c.source ?? 'auto_recommend',
          recReason: c.recReason ?? null,
          publishedAt: c.publishedAt?.toISOString() ?? null,
          startSec: null,
        };
        notifyCardAdded(mandalaId, payload);
      } catch (notifyErr) {
        log.warn(
          `placeAutoAddedCards notifyCardAdded failed for video=${c.videoId}: ${
            notifyErr instanceof Error ? notifyErr.message : String(notifyErr)
          }`
        );
      }
    }
  }

  return { inserted };
}
