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
}

interface Placement {
  cellIndex: number;
  videoId: string; // 11-char YouTube id
  title: string;
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
      select: { cell_index: true, video: { select: { youtube_video_id: true, title: true } } },
    }),
    prisma.user_local_cards.findMany({
      where: { user_id: userId, mandala_id: mandalaId, cell_index: { gte: 0 } },
      select: { cell_index: true, video_id: true, title: true, metadata_title: true },
    }),
  ]);

  const placements: Placement[] = [];
  for (const r of videoStates) {
    const vid = r.video?.youtube_video_id;
    if (!vid || r.cell_index == null) continue;
    placements.push({ cellIndex: r.cell_index, videoId: vid, title: r.video?.title ?? vid });
  }
  for (const r of localCards) {
    // Non-YouTube manual cards have no video_id → no v2 → honest skip.
    if (!r.video_id || r.cell_index == null) continue;
    placements.push({
      cellIndex: r.cell_index,
      videoId: r.video_id,
      title: r.title ?? r.metadata_title ?? r.video_id,
    });
  }

  if (placements.length === 0) {
    return { ok: false, action: 'skipped-no-videos', mandalaId, reason: 'no placed videos' };
  }

  // 2. Fetch v2 summaries; keep only rows with a usable (non-null) segments blob.
  const videoIds = Array.from(new Set(placements.map((p) => p.videoId)));
  const v2Rows = await prisma.video_rich_summaries.findMany({
    where: { video_id: { in: videoIds }, template_version: 'v2' },
    select: { video_id: true, analysis: true, segments: true, lora: true },
  });

  const v2ByVideo = new Map<string, V2Columns>();
  for (const row of v2Rows) {
    if (row.segments == null) continue; // no time-segments → not a usable 살붙임 source
    v2ByVideo.set(row.video_id, {
      analysis: (row.analysis ?? null) as RichSummaryAnalysis | null,
      segments: (row.segments ?? null) as unknown as RichSummarySegments | null,
      lora: (row.lora ?? null) as RichSummaryLora | null,
    });
  }

  // 3. Group into cells. One chapter per cell (skeleton = mandala cells). A cell
  // with no usable-v2 videos yields an empty chapter (honest skip, not dropped).
  const numCells =
    subjects.length > 0 ? subjects.length : Math.max(0, ...placements.map((p) => p.cellIndex)) + 1;

  const cells: CellInput[] = [];
  for (let i = 0; i < numCells; i++) {
    const title = subjectLabels[i] || subjects[i] || `Cell ${i + 1}`;
    const videos: CellVideoV2[] = [];
    const seen = new Set<string>();
    for (const p of placements) {
      if (p.cellIndex !== i) continue;
      const v2 = v2ByVideo.get(p.videoId);
      if (!v2) continue; // no usable v2 → honest skip
      if (seen.has(p.videoId)) continue; // dedup a video within one cell
      seen.add(p.videoId);
      videos.push({
        videoId: p.videoId,
        title: p.title,
        analysis: v2.analysis,
        segments: v2.segments,
        lora: v2.lora,
      });
    }
    cells.push({ cellIndex: i, title, videos });
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
       (mandala_id, book_json, version, source_videos, source_atoms, generated_at, updated_at)
     VALUES ($1::uuid, $2::jsonb, 1, $3, $4, NOW(), NOW())
     ON CONFLICT (mandala_id) DO UPDATE SET
       book_json     = EXCLUDED.book_json,
       source_videos = EXCLUDED.source_videos,
       source_atoms  = EXCLUDED.source_atoms,
       version       = mandala_books.version + 1,
       updated_at    = NOW()
     RETURNING version`,
    mandalaId,
    JSON.stringify(validated),
    sourceVideos,
    sourceAtoms
  );

  const version = rows[0]?.version ?? 1;
  log.info('mandala book filled', {
    mandalaId,
    sourceVideos,
    sourceAtoms,
    chapters: cells.length,
    version,
    trigger: params.trigger,
  });
  return {
    ok: true,
    action: 'filled',
    mandalaId,
    sourceVideos,
    sourceAtoms,
    chapters: cells.length,
    version,
  };
}
