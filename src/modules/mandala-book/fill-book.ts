// Mandala book fill orchestrator (§2-D #1).
//
// Reads a mandala's placed videos + their v2 rich summaries from the DB, hands
// them to the PURE buildBookJson assembler (no LLM there), validates the result
// against the v2 contract, and upserts mandala_books with a version bump.
//
// This module does the DB I/O; build-book.ts does the (LLM-free) assembly. The
// validator (parseBookJson) is a HARD gate: on any shape violation we log and
// abort — never a partial upsert.

import { getPrismaClient } from '@/modules/database/client';
import { getMandalaManager } from '@/modules/mandala/manager';
import { logger } from '@/utils/logger';
import { buildBookJson, type CellInput, type CellVideoV2 } from './build-book';
import { parseBookJson } from './book-schema';
import {
  loadBookGateConfig,
  passesBookGate,
  isBookTopicSynthesisEnabled,
} from '@/config/book-gate';
import { synthesizeCellTopics } from './topic-synthesis';
import { enqueueEnrichRichSummary } from '@/modules/queue';
import { enqueueRelevanceBackfillForMandala } from '@/modules/relevance/relevance-backfill-trigger';
import type {
  RichSummaryAnalysis,
  RichSummarySegments,
  RichSummaryLora,
} from '@/modules/skills/rich-summary-v2-prompt';

const log = logger.child({ module: 'mandala-book/fill-book' });

export interface FillBookResult {
  ok: boolean;
  action: 'filled' | 'skipped-no-mandala' | 'skipped-no-videos' | 'failed';
  mandalaId: string;
  sourceVideos?: number;
  sourceAtoms?: number;
  chapters?: number;
  version?: number;
  reason?: string;
  // §1④ coverage — for progress UI (PR2 spinner / "준비 중"). gate-passed cards
  // = the denominator; v2Done are in the book now; v2Pending were enqueued.
  coverage?: { gatePassed: number; v2Done: number; v2Pending: number };
}

interface Placement {
  cellIndex: number;
  videoId: string; // 11-char YouTube id
  title: string;
  relevance: number | null; // uvs/ulc relevance_pct; null = never scored
}

interface V2Columns {
  analysis: RichSummaryAnalysis | null;
  segments: RichSummarySegments | null;
  lora: RichSummaryLora | null;
}

/**
 * Build (or rebuild) a mandala's book from its placed videos' v2 summaries.
 * Idempotent: a re-run overwrites book_json and bumps version.
 */
export async function fillMandalaBook(params: {
  userId: string;
  mandalaId: string;
  trigger?: string;
}): Promise<FillBookResult> {
  const { userId, mandalaId } = params;
  const prisma = getPrismaClient();

  const mandala = await getMandalaManager().getMandalaById(userId, mandalaId);
  if (!mandala) {
    return { ok: false, action: 'skipped-no-mandala', mandalaId, reason: 'mandala not found' };
  }

  const root = mandala.levels[0];
  const subjects = root?.subjects ?? [];
  const subjectLabels = root?.subjectLabels ?? [];

  // 1. Enumerate placed videos per cell across both user-scoped tables.
  const [videoStates, localCards] = await Promise.all([
    prisma.userVideoState.findMany({
      where: { user_id: userId, mandala_id: mandalaId, cell_index: { gte: 0 } },
      select: {
        cell_index: true,
        relevance_pct: true,
        video: { select: { youtube_video_id: true, title: true } },
      },
    }),
    prisma.user_local_cards.findMany({
      where: { user_id: userId, mandala_id: mandalaId, cell_index: { gte: 0 } },
      select: {
        cell_index: true,
        video_id: true,
        title: true,
        metadata_title: true,
        relevance_pct: true,
      },
    }),
  ]);

  const placements: Placement[] = [];
  for (const r of videoStates) {
    const vid = r.video?.youtube_video_id;
    if (!vid || r.cell_index == null) continue;
    placements.push({
      cellIndex: r.cell_index,
      videoId: vid,
      title: r.video?.title ?? vid,
      relevance: r.relevance_pct ?? null,
    });
  }
  for (const r of localCards) {
    // Non-YouTube manual cards have no video_id → no v2 → honest skip.
    if (!r.video_id || r.cell_index == null) continue;
    placements.push({
      cellIndex: r.cell_index,
      videoId: r.video_id,
      title: r.title ?? r.metadata_title ?? r.video_id,
      relevance: r.relevance_pct ?? null,
    });
  }

  if (placements.length === 0) {
    return { ok: false, action: 'skipped-no-videos', mandalaId, reason: 'no placed videos' };
  }

  // 2. Fetch v2 summaries; keep only rows with a usable (non-null) segments blob.
  const videoIds = Array.from(new Set(placements.map((p) => p.videoId)));
  const v2Rows = await prisma.video_rich_summaries.findMany({
    where: { video_id: { in: videoIds }, template_version: 'v2' },
    select: { video_id: true, analysis: true, segments: true, lora: true, quality_flag: true },
  });

  const v2ByVideo = new Map<string, V2Columns>();
  // Terminally-skipped videos (quality_flag='skipped' = no transcript / un-enrichable).
  // §1④ must NOT re-enqueue these every fill (the enrich handler would re-throw
  // NO_TRANSCRIPT each time = caption-fetch churn). They are absent from the book
  // (no content) but excluded from the v2-pending enqueue.
  const terminallySkipped = new Set<string>();
  for (const row of v2Rows) {
    if (row.quality_flag === 'skipped') terminallySkipped.add(row.video_id);
    if (row.segments == null) continue; // no time-segments → not a usable 살붙임 source
    v2ByVideo.set(row.video_id, {
      analysis: (row.analysis ?? null) as RichSummaryAnalysis | null,
      segments: (row.segments ?? null) as unknown as RichSummarySegments | null,
      lora: (row.lora ?? null) as RichSummaryLora | null,
    });
  }

  // 3. Group into cells. One chapter per cell (skeleton = mandala cells). A cell
  // with no usable-v2 videos yields an empty chapter (honest skip, not dropped).
  //
  // SELECTION GATE (§1③): a placed video is sectioned only if it CONTRIBUTES to
  // the book — relevance_pct >= the gate min (drops scored-low / off-topic cards
  // like a rel=5 stock video). null relevance = unscored → gate config decides
  // (default pass, logged — not a silent leak). Placement (mandala data) is
  // untouched; the gate filters the BOOK only.
  const gate = loadBookGateConfig();
  let gatedLow = 0;
  let gatedNullPass = 0;
  // §1④ coverage — the book targets the GATE-PASSED cards as a whole. The order
  // is GATE first, then v2: a passed card with no usable v2 is NOT dropped, it is
  // recorded as "v2 pending" and its v2 is enqueued, so the book progressively
  // fills to the full passed set (was: v2-missing skipped → only ~v2'd cards
  // ever appeared). v2 completion re-fires this fill via the #958 trigger.
  let gatePassed = 0; // distinct passed cards (the coverage denominator)
  let v2Done = 0; // passed AND usable-v2 present (in the book now)
  const v2Pending = new Set<string>(); // passed but v2 missing → enqueue
  let hasNullRelevance = false; // any unscored passed card → backfill relevance
  const enqueuedGlobal = new Set<string>(); // dedup enqueue across cells
  const numCells =
    subjects.length > 0 ? subjects.length : Math.max(0, ...placements.map((p) => p.cellIndex)) + 1;

  const cells: CellInput[] = [];
  for (let i = 0; i < numCells; i++) {
    const title = subjectLabels[i] || subjects[i] || `Cell ${i + 1}`;
    const videos: CellVideoV2[] = [];
    const seen = new Set<string>();
    for (const p of placements) {
      if (p.cellIndex !== i) continue;
      if (seen.has(p.videoId)) continue; // dedup a video within one cell
      // §1③ GATE FIRST (before v2) — a scored-low / off-topic card is dropped
      // regardless of v2. Reordered: v2-absence no longer short-circuits the gate.
      if (!passesBookGate(p.relevance, gate)) {
        gatedLow += 1; // scored below the gate min → excluded from the book
        continue;
      }
      if (p.relevance == null) {
        gatedNullPass += 1; // unscored card passed (logged)
        hasNullRelevance = true; // → enqueue relevance backfill so the gate becomes meaningful
      }
      seen.add(p.videoId);
      gatePassed += 1;
      const v2 = v2ByVideo.get(p.videoId);
      if (v2) {
        v2Done += 1;
        videos.push({
          videoId: p.videoId,
          title: p.title,
          analysis: v2.analysis,
          segments: v2.segments,
          lora: v2.lora,
        });
      } else if (!terminallySkipped.has(p.videoId)) {
        // Passed the gate but no usable v2 yet → "v2 pending". Enqueue v2 (deduped);
        // the post-enrich #958 trigger re-fills this book once it completes.
        // Terminally-skipped (no transcript) cards are NOT pending — un-enrichable.
        v2Pending.add(p.videoId);
      }
    }
    cells.push({ cellIndex: i, title, videos });
  }

  // §1④ coverage enqueues — fire-and-forget (book write must not block on them).
  // [INV-BOOK-COVERAGE] passed-but-v2-missing cards get their v2 enqueued so the
  // book converges to the full gate-passed set (not just incidentally-v2'd cards).
  for (const videoId of v2Pending) {
    if (enqueuedGlobal.has(videoId)) continue;
    enqueuedGlobal.add(videoId);
    const title = placements.find((p) => p.videoId === videoId)?.title ?? videoId;
    enqueueEnrichRichSummary({ videoId, userId, mandalaId, title }).catch((err) => {
      log.warn('§1④ v2 enqueue failed (non-fatal)', {
        videoId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }
  // Unscored passed cards → enqueue relevance backfill (Haiku) so the gate is
  // meaningful on the next fill. Scoring populates relevance; it does not drop.
  if (hasNullRelevance) {
    // applyCutoff:false = score ALL unscored cards in the mandala (not just
    // recently-added) so the gate becomes meaningful for the whole book.
    enqueueRelevanceBackfillForMandala({ userId, mandalaId, applyCutoff: false }).catch((err) => {
      log.warn('§1④ relevance backfill enqueue failed (non-fatal)', {
        mandalaId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  // 3b. §1⑤ topic synthesis (flag-gated; off = legacy per-video). For each
  // non-empty cell, pool its videos' atoms → synthesizeCellTopics → attach
  // topics. build-book then builds sections per TOPIC (not per video), removing
  // defect-1 (section title = video title). A cell whose synthesis fails keeps
  // topics undefined → build-book falls back to per-video for THAT cell (safe).
  // This is the only non-deterministic step; build-book stays pure.
  if (isBookTopicSynthesisEnabled()) {
    let synthOk = 0;
    const failedCells: string[] = [];
    for (const cell of cells) {
      const atoms = cell.videos.flatMap((v) =>
        (v.segments?.atoms ?? [])
          .filter((a) => typeof a.timestamp_sec === 'number')
          .map((a) => ({ vid: v.videoId, ts: a.timestamp_sec as number, text: a.text }))
      );
      if (atoms.length === 0) continue; // empty cell → no synthesis, no topics
      const r = await synthesizeCellTopics(cell.title, atoms); // retries internally
      if (r.ok) {
        cell.topics = r.topics;
        synthOk += 1;
      } else {
        // HARD fail after retries. This cell falls to legacy per-video (defect-1
        // clickbait titles) — surfaced LOUDLY here so it is NOT a silent revert.
        // (8000 tokens makes 942's cells fit; a hard fail signals a too-large
        // cell that needs chunking — see backlog.)
        failedCells.push(cell.title);
      }
    }
    if (failedCells.length > 0) {
      log.error('topic synthesis HARD-FAILED cells → legacy/clickbait fallback (NOT silent)', {
        mandalaId,
        cellsSynthesized: synthOk,
        failedCells,
      });
    } else {
      log.info('topic synthesis', { mandalaId, cellsSynthesized: synthOk, failedCells: 0 });
    }
  }

  // 4. Assemble (pure, LLM-free) + validate (hard gate).
  const generatedAt = new Date().toISOString();
  const { book, sourceVideos, sourceAtoms } = buildBookJson({
    mandalaId,
    mandalaTitle: mandala.title ?? '',
    generatedAt,
    cells,
  });

  let validated;
  try {
    validated = parseBookJson(book);
  } catch (err) {
    log.error('book failed schema validation — aborting upsert (no partial write)', {
      mandalaId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, action: 'failed', mandalaId, reason: 'schema validation failed' };
  }

  // 5. Upsert with version bump. Raw SQL — the mandala_books Prisma model may
  // lag client regen on some deploys (same reason GET /:id/book uses raw SQL).
  const rows = await prisma.$queryRawUnsafe<Array<{ version: number }>>(
    `INSERT INTO mandala_books
       (mandala_id, book_json, version, source_videos, source_atoms,
        gate_passed, v2_done, v2_pending, generated_at, updated_at)
     VALUES ($1::uuid, $2::jsonb, 1, $3, $4, $5, $6, $7, NOW(), NOW())
     ON CONFLICT (mandala_id) DO UPDATE SET
       book_json     = EXCLUDED.book_json,
       source_videos = EXCLUDED.source_videos,
       source_atoms  = EXCLUDED.source_atoms,
       gate_passed   = EXCLUDED.gate_passed,
       v2_done       = EXCLUDED.v2_done,
       v2_pending    = EXCLUDED.v2_pending,
       version       = mandala_books.version + 1,
       updated_at    = NOW()
     RETURNING version`,
    mandalaId,
    JSON.stringify(validated),
    sourceVideos,
    sourceAtoms,
    gatePassed,
    v2Done,
    v2Pending.size
  );

  const version = rows[0]?.version ?? 1;
  log.info('mandala book filled', {
    mandalaId,
    sourceVideos,
    sourceAtoms,
    chapters: cells.length,
    version,
    trigger: params.trigger,
    // selection gate: scored-low dropped + unscored passed (visible, not silent)
    gatedLow,
    gatedNullPass,
    gateMin: gate.minRelevance,
    gatePassNull: gate.passNull,
    // §1④ coverage: passed denominator, v2-ready (in book now), v2-pending (enqueued)
    gatePassed,
    v2Done,
    v2Pending: v2Pending.size,
  });
  return {
    ok: true,
    action: 'filled',
    mandalaId,
    sourceVideos,
    sourceAtoms,
    chapters: cells.length,
    version,
    coverage: { gatePassed, v2Done, v2Pending: v2Pending.size },
  };
}
