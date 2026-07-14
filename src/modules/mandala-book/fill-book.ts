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
import { parseBookJson, type BookJsonInput } from './book-schema';
import {
  loadBookGateConfig,
  passesBookGateOrBookmarked,
  computeMandalaMedian,
  isBookTopicSynthesisEnabled,
  isBookNarrativeSkeletonEnabled,
  isBookEnrichEnabled,
  isVisualCvEnabled,
  loadNoteMaxSections,
} from '@/config/book-gate';
import { synthesizeCellTopics } from './topic-synthesis';
import { synthesizeBookSkeleton, type BookSkeleton } from './book-skeleton';
import { weaveChapterBody } from './book-body';
import { researchBookGaps } from './book-research';
import { factcheckChapterBody } from './book-factcheck';
import { createWebSearchClient, loadWebSearchConfig } from '@/modules/web-search';
import { enqueueEnrichRichSummary, enqueueNoteCvEnrich } from '@/modules/queue';
import { enqueueRelevanceBackfillForMandala } from '@/modules/relevance/relevance-backfill-trigger';
import { getStoredTranslation } from '@/modules/skills/rich-summary-translator';
import { getArchivedVideoIds } from '@/modules/exclude/archived-videos';
import { bookV2RetryCapped } from './book-v2-retry';
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
  bookmarked: boolean; // pinned_at != null — bookmarked cards bypass the relevance gate
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
        pinned_at: true,
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
        pinned_at: true,
      },
    }),
  ]);

  // CP504 archive display gate (mandala-scoped) — a video archived in THIS
  // mandala must not be synthesised into the book (measured: 4 archived videos
  // were leaking into notes). Placement rows (uvs/ulc) are untouched; only the
  // book input is filtered.
  const archivedIds = await getArchivedVideoIds(prisma, userId, mandalaId);

  const placements: Placement[] = [];
  for (const r of videoStates) {
    const vid = r.video?.youtube_video_id;
    if (!vid || r.cell_index == null) continue;
    if (archivedIds.has(vid)) continue;
    placements.push({
      cellIndex: r.cell_index,
      videoId: vid,
      title: r.video?.title ?? vid,
      relevance: r.relevance_pct ?? null,
      bookmarked: r.pinned_at != null,
    });
  }
  for (const r of localCards) {
    // Non-YouTube manual cards have no video_id → no v2 → honest skip.
    if (!r.video_id || r.cell_index == null) continue;
    if (archivedIds.has(r.video_id)) continue;
    placements.push({
      cellIndex: r.cell_index,
      videoId: r.video_id,
      title: r.title ?? r.metadata_title ?? r.video_id,
      relevance: r.relevance_pct ?? null,
      bookmarked: r.pinned_at != null,
    });
  }

  if (placements.length === 0) {
    return { ok: false, action: 'skipped-no-videos', mandalaId, reason: 'no placed videos' };
  }

  // 2. Fetch v2 summaries; keep only rows with a usable (non-null) segments blob.
  const videoIds = Array.from(new Set(placements.map((p) => p.videoId)));
  const v2Rows = await prisma.video_rich_summaries.findMany({
    where: { video_id: { in: videoIds }, template_version: 'v2' },
    select: {
      video_id: true,
      analysis: true,
      segments: true,
      lora: true,
      quality_flag: true,
      // PR-T2 — translation derived layer. When the mandala language differs from
      // the atom's source language, display the stored ko/en translation instead
      // of the source-language atoms. v2 atoms stay source-language-fixed (global
      // cache untouched); this is a DISPLAY substitution only.
      source_language: true,
      translations: true,
    },
  });

  // Display language = mandala language (ko default). Off-language atoms are
  // substituted with their stored translation if present (PR-T1 populates it on
  // card-add close; absent ⇒ source-language atoms shown until it lands).
  const displayLang: 'ko' | 'en' = mandala.language === 'en' ? 'en' : 'ko';

  const v2ByVideo = new Map<string, V2Columns>();
  // Terminally-skipped videos (quality_flag='skipped' = no transcript / un-enrichable).
  // §1④ must NOT re-enqueue these every fill (the enrich handler would re-throw
  // NO_TRANSCRIPT each time = caption-fetch churn). They are absent from the book
  // (no content) but excluded from the v2-pending enqueue.
  const terminallySkipped = new Set<string>();
  // quality_flag per video — used to split "준비 중" (never-attempted, genuinely
  // generating) from 'low' (already failed generation: NOT pending — it must not
  // keep the spinner up; it gets a bounded background retry instead).
  const qfByVideo = new Map<string, string>();
  // §1④ retry counts per video (translations._book_v2_retry). At the cap, the
  // card is terminal (can't yield segments) → excluded from v2-pending so the
  // spinner ends. NOT a blanket quality_flag='low' exclude (that would drop
  // transiently-failed cards permanently — #968 was held for this reason).
  for (const row of v2Rows) {
    if (row.quality_flag) qfByVideo.set(row.video_id, row.quality_flag);
    // Terminal: no-transcript skip, OR §1④ re-enqueued to the cap with no segments.
    if (row.quality_flag === 'skipped' || bookV2RetryCapped(row.translations)) {
      terminallySkipped.add(row.video_id);
    }
    if (row.segments == null) continue; // no time-segments → not a usable 살붙임 source
    // PR-T2 — substitute the translated atoms when this atom's source language
    // differs from the display language AND a translation is stored. The
    // translation mirrors the v2 structure (sameShape-validated at store time),
    // so analysis/segments are drop-in. Falls back to source atoms when absent.
    const tr =
      row.source_language && row.source_language !== displayLang
        ? getStoredTranslation(row.translations, displayLang)
        : null;
    v2ByVideo.set(row.video_id, {
      analysis: (tr?.analysis ?? row.analysis ?? null) as RichSummaryAnalysis | null,
      segments: (tr?.segments ?? row.segments ?? null) as unknown as RichSummarySegments | null,
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
  // CP504 §0.3 D3 — per-mandala median over SCORED placed cards (one video =
  // one vote; dedup so a video in two cells doesn't double-weight). Inert in
  // absolute mode; used only when BOOK_GATE_MODE=relative.
  const relByVideo = new Map<string, number | null>();
  for (const pl of placements) {
    if (!relByVideo.has(pl.videoId)) relByVideo.set(pl.videoId, pl.relevance);
  }
  const gateCtx = computeMandalaMedian(Array.from(relByVideo.values()));
  let gatedLow = 0;
  let gatedNullPass = 0;
  // §1④ coverage — the book targets the GATE-PASSED cards as a whole. The order
  // is GATE first, then v2: a passed card with no usable v2 is NOT dropped, it is
  // recorded as "v2 pending" and its v2 is enqueued, so the book progressively
  // fills to the full passed set (was: v2-missing skipped → only ~v2'd cards
  // ever appeared). v2 completion re-fires this fill via the #958 trigger.
  let gatePassed = 0; // distinct passed cards (the coverage denominator)
  let v2Done = 0; // passed AND usable-v2 present (in the book now)
  // v2Pending = the SPINNER count: passed cards genuinely generating for the first
  // time (never attempted / quality_flag='pending'). 'low' cards (already failed)
  // are NOT pending — they must not keep the spinner up — but still get a bounded
  // background retry (v2ToEnqueue) so a transient 'low' can still recover.
  const v2Pending = new Set<string>();
  const v2ToEnqueue = new Set<string>(); // pending + background-retry 'low' (counter<CAP)
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
      // Bookmark exception (user directive): a card the user bookmarked (pinned)
      // stays in the book even below the relevance gate — explicit intent wins.
      if (!passesBookGateOrBookmarked(p.relevance, p.bookmarked, gateCtx, gate)) {
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
        // Passed the gate but no usable v2 yet. Split by why:
        //   - 'low' (already failed generation, counter < CAP since capped ones
        //     are terminallySkipped): NOT pending (don't keep the spinner up on a
        //     failed card) — enqueue one bounded BACKGROUND retry only.
        //   - never-attempted (no row / quality_flag='pending'): genuine "준비 중"
        //     → counts toward the spinner AND is enqueued.
        // v2 completion re-fires this fill via the #958 trigger either way.
        if (qfByVideo.get(p.videoId) === 'low') {
          v2ToEnqueue.add(p.videoId);
        } else {
          v2Pending.add(p.videoId);
          v2ToEnqueue.add(p.videoId);
        }
      }
    }
    cells.push({ cellIndex: i, title, videos });
  }

  // §1④ coverage enqueues — fire-and-forget (book write must not block on them).
  // [INV-BOOK-COVERAGE] passed-but-v2-missing cards get their v2 enqueued so the
  // book converges to the full gate-passed set (not just incidentally-v2'd cards).
  for (const videoId of v2ToEnqueue) {
    if (enqueuedGlobal.has(videoId)) continue;
    enqueuedGlobal.add(videoId);
    const title = placements.find((p) => p.videoId === videoId)?.title ?? videoId;
    // §1④ retry-cap — count this re-enqueue in the dedicated jsonb counter
    // (atomic jsonb_set so concurrent fills don't lose increments). At the cap,
    // the NEXT fill's terminallySkipped excludes this card → v2_pending drops →
    // spinner ends. No-op when the row doesn't exist yet (first attempt); the
    // enrich then creates the row and the counter applies on subsequent retries.
    prisma
      .$executeRawUnsafe(
        `UPDATE video_rich_summaries
         SET translations = jsonb_set(
           COALESCE(translations, '{}'::jsonb),
           '{_book_v2_retry}',
           to_jsonb(COALESCE((translations->>'_book_v2_retry')::int, 0) + 1)
         )
         WHERE video_id = $1`,
        videoId
      )
      .catch(() => {
        /* counter bump is best-effort; a missed increment just allows one extra retry */
      });
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
    // CP504 §1⑤ surface-fix #3 — note-level section budget. Pre-pool each cell's
    // atoms so NOTE_MAX_SECTIONS can be distributed across cells by atom share
    // (big cells get more sections; the note total — not just each cell — stays
    // "5-min scannable", TOC under the video menu).
    const noteMaxSections = loadNoteMaxSections();
    const cellAtomLists = cells.map((cell) =>
      cell.videos.flatMap((v) =>
        (v.segments?.atoms ?? [])
          .filter((a) => typeof a.timestamp_sec === 'number')
          .map((a) => ({ vid: v.videoId, ts: a.timestamp_sec as number, text: a.text }))
      )
    );
    const totalAtoms = cellAtomLists.reduce((sum, a) => sum + a.length, 0);
    let synthOk = 0;
    let atomsIn = 0; // total atoms fed to compression
    let atomsCompressed = 0; // §1⑤ intentional drop (removed.compressed) — transparency
    const failedCells: string[] = [];
    for (let ci = 0; ci < cells.length; ci++) {
      const cell = cells[ci]!;
      const atoms = cellAtomLists[ci]!;
      if (atoms.length === 0) continue; // empty cell → no synthesis, no topics
      // This cell's share of the note budget (≥ MIN handled inside synthesize).
      const cellCap =
        totalAtoms > 0
          ? Math.round((noteMaxSections * atoms.length) / totalAtoms)
          : noteMaxSections;
      // §1⑤ COMPRESSION: the mandala center goal (mandala.title) is the importance
      // yardstick. Low-value atoms are intentionally dropped (removed.compressed).
      const r = await synthesizeCellTopics(cell.title, atoms, mandala.title ?? '', cellCap); // retries internally
      if (r.ok) {
        cell.topics = r.topics;
        synthOk += 1;
        atomsIn += atoms.length;
        atomsCompressed += r.removed.compressed.length;
      } else {
        // HARD fail after retries. This cell falls to legacy per-video (defect-1
        // clickbait titles) — surfaced LOUDLY here so it is NOT a silent revert.
        failedCells.push(cell.title);
      }
    }
    const compressionPct = atomsIn ? Math.round((atomsCompressed / atomsIn) * 100) : 0;
    if (failedCells.length > 0) {
      log.error('topic synthesis HARD-FAILED cells → legacy/clickbait fallback (NOT silent)', {
        mandalaId,
        cellsSynthesized: synthOk,
        failedCells,
        atomsIn,
        atomsCompressed,
        compressionPct,
      });
    } else {
      log.info('topic synthesis (compression)', {
        mandalaId,
        cellsSynthesized: synthOk,
        atomsIn,
        atomsCompressed, // §1⑤ removed.compressed total — nullable→deck/note shorter
        compressionPct,
      });
    }
  }

  // 3c. §4.5.1 [2] narrative skeleton (flag-gated; off ⇒ legacy cell=chapter).
  // Reconstruct ALL cells' §1⑤ topics into a narrative book outline (cross-cell
  // merge + 기승전결 order + chapter intro). The flat topic list = cells in order,
  // each cell's topics flattened — this MUST match build-book's flatTopics order
  // (input.cells.flatMap(c => c.topics)) so the skeleton's topic_refs line up.
  // HARD fail → skeleton stays undefined → build-book uses legacy cell=chapter.
  let skeleton: BookSkeleton | undefined;
  if (isBookNarrativeSkeletonEnabled()) {
    const skeletonTopics = cells.flatMap((cell) =>
      (cell.topics ?? []).map((tp) => ({
        cellIndex: cell.cellIndex,
        cellTitle: cell.title,
        topicTitle: tp.topic_title,
        summary: tp.summary,
      }))
    );
    if (skeletonTopics.length > 0) {
      const sk = await synthesizeBookSkeleton(skeletonTopics, mandala.title ?? '');
      if (sk.ok) {
        skeleton = sk.skeleton;
        log.info('book narrative skeleton (compression→reconstruction)', {
          mandalaId,
          topicsIn: skeletonTopics.length,
          chapters: sk.skeleton.chapters.length,
          topicsUnplaced: sk.unplaced.length, // transparency — surfaced, not auto-appended
        });
      } else {
        // Surfaced LOUDLY — NOT a silent revert (caller falls to cell=chapter).
        log.error('book narrative skeleton HARD-FAILED → legacy cell=chapter (NOT silent)', {
          mandalaId,
          reason: sk.reason,
        });
      }
    }
  }

  // 3d. §4.5.1 [3] chapter body weave — ONLY when the skeleton succeeded. For
  // each narrative chapter, rewrite its topics' summaries into chapter-aware
  // flowing prose (서사=창작 / 사실=요약 출처, no new facts). Mutates topic.summary
  // in place (build-book skeleton mode reads it via sectionFromTopic); atom_refs
  // untouched (provenance travels). Fail → keep the original summary (no
  // fabrication, no broken chapter). flat order matches build-book's flatTopics
  // and the skeleton's topic_refs (cells in order, topics flattened).
  if (skeleton) {
    const flat = cells.flatMap((c) => c.topics ?? []);
    let wovenChapters = 0;
    for (const ch of skeleton.chapters) {
      const chTopics = ch.topic_refs
        .map((i) => flat[i])
        .filter((t): t is NonNullable<typeof t> => t != null);
      if (chTopics.length === 0) continue;
      const woven = await weaveChapterBody(
        ch.title,
        ch.intro,
        chTopics.map((t) => ({ topicTitle: t.topic_title, summary: t.summary })),
        mandala.title ?? ''
      );
      if (woven.ok) {
        woven.sections.forEach(({ narrative, keyPoints, keyPoint }, i) => {
          const t = chTopics[i];
          if (!t) return;
          if (narrative) t.summary = narrative; // enrich in place; empty slot ⇒ keep original
          if (keyPoints.length > 0) t.keyPoints = keyPoints; // back-compat
          if (keyPoint) t.keyPoint = keyPoint; // NOTE-DENSITY ①-v2 — prose synthesis quote
        });
        wovenChapters += 1;
      }
    }
    log.info('book chapter bodies woven', {
      mandalaId,
      chapters: skeleton.chapters.length,
      wovenChapters, // chapters that got LLM-woven prose (rest kept §1⑤ summaries)
    });
  }

  // 4. Assemble (pure, LLM-free) + validate (hard gate).
  const generatedAt = new Date().toISOString();
  const { book, sourceVideos, sourceAtoms } = buildBookJson({
    mandalaId,
    mandalaTitle: mandala.title ?? '',
    generatedAt,
    cells,
    skeleton, // §4.5.1 — undefined ⇒ legacy cell=chapter assembly
  });

  // 4b. §4.5.1 [4] loop-2 enrichment — research gap-fill (STORM) + factcheck.
  // ONLY when a narrative skeleton exists AND enrich is enabled (separate flag —
  // external CSE + Haiku calls, real cost). Augments `book` ADDITIVELY before
  // validation: book.references[] + chapter.research[] (web facts) and
  // section.verification.checks[] (per-atom verdict + correction PROPOSAL — the
  // woven prose is NOT rewritten, A1). Best-effort; failures leave book unchanged.
  if (skeleton && isBookEnrichEnabled()) {
    await enrichBookLoop2(book, mandala.title ?? '', mandalaId);
  }

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

  // [CV-NOTE-WIRE] CP505 — visual CV figure enrich, enqueued AFTER the book is
  // committed (above). The handler reads the SAVED book_json; enqueuing pre-save
  // raced → detect read a stale/absent note (fresh mandala → "book_json 없음" → 0
  // figures). Now it always sees the completed note. Fire-and-forget; default inert.
  if (skeleton && isVisualCvEnabled()) {
    enqueueNoteCvEnrich(mandalaId, userId).catch((err) => {
      log.warn('note-cv-enrich enqueue failed (non-fatal)', {
        mandalaId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

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

// Bound external CSE+Haiku calls per book-fill (cost guard, RPT-5).
const MAX_FACTCHECK_ATOMS = 24;

/**
 * §4.5.1 [4] loop-2 enrichment — mutates `book` ADDITIVELY (caller gates on
 * skeleton + BOOK_ENRICH_ENABLED). research (STORM): web gap-fill → book.references[]
 * + chapter.research[] (fact + ref_id). factcheck (A1): per-section atoms (the
 * sourced fact units) → section.verification.checks[] (verdict + correction
 * PROPOSAL; the woven prose is NOT rewritten). Each half is best-effort (try/catch)
 * so a CSE/LLM failure leaves the book unchanged. External call counts logged.
 */
async function enrichBookLoop2(
  book: BookJsonInput,
  centerGoal: string,
  mandalaId: string
): Promise<void> {
  const chapters = book.chapters ?? [];
  const wsConfig = loadWebSearchConfig();
  const cse = createWebSearchClient(wsConfig);
  if (!wsConfig.enabled) {
    // Silent-0 class (2026-07-14 incident): the CSE credentials behind the
    // original research/factcheck were never provisioned — 2 months of 0
    // findings + evidence-free verdicts with no signal. Degradation must be
    // LOUD, never silent.
    log.warn(
      'web-search unset — book research yields 0 findings and factcheck runs WITHOUT web ' +
        'evidence (NAVER_CLIENT_ID/SECRET + OPENROUTER_API_KEY; credentials.md)',
      { mandalaId }
    );
  } else if (!wsConfig.naverEnabled || !wsConfig.globalEnabled) {
    log.warn(
      `web-search partial — ${wsConfig.naverEnabled ? 'global(en/ja/zh)' : 'naver(ko)'} leg ` +
        'unconfigured; queries in that language yield no evidence',
      { mandalaId }
    );
  }

  // research (loop-2-B) — web gap-fill, reference-tracked (P-2B-REF).
  try {
    const chapterInputs = chapters.map((c) => ({
      title: c.title,
      intro: c.intro ?? '',
      sectionSummaries: (c.sections ?? []).map((s) => s.narrative).filter(Boolean),
    }));
    const research = await researchBookGaps(chapterInputs, centerGoal, cse);
    if (research.ok && research.findings.length > 0) {
      const refs: Array<{ id: number; title: string; url: string }> = [];
      const idByUrl = new Map<string, number>();
      for (const f of research.findings) {
        let id = idByUrl.get(f.reference.url);
        if (id == null) {
          id = refs.length + 1;
          idByUrl.set(f.reference.url, id);
          refs.push({ id, title: f.reference.title, url: f.reference.url });
        }
        const ch = chapters.find((c) => c.title === f.chapterTitle);
        if (ch) (ch.research ??= []).push({ perspective: f.perspective, fact: f.fact, ref_id: id });
      }
      if (refs.length > 0) book.references = refs;
      log.info('book research enrich (CSE)', {
        mandalaId,
        findings: research.findings.length,
        references: refs.length,
        cseCalls: research.findings.length, // ~1 CSE search per gap (RPT-5)
      });
    }
  } catch (err) {
    log.warn('book research enrich failed (non-fatal)', {
      mandalaId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // factcheck (loop-2-A, A1) — atoms are the sourced fact units; verdicts +
  // correction PROPOSALS land in section.verification (prose untouched). Capped.
  try {
    let budget = MAX_FACTCHECK_ATOMS;
    let sectionsChecked = 0;
    for (const ch of chapters) {
      for (const s of ch.sections ?? []) {
        if (budget <= 0) break;
        const atoms = (s.atoms ?? []).slice(0, budget);
        if (atoms.length === 0) continue;
        budget -= atoms.length;
        sectionsChecked += 1;
        const fc = await factcheckChapterBody(
          atoms.map((a) => ({ text: a.text, hasSource: true })),
          cse
        );
        if (fc.ok && fc.results.length > 0) {
          s.verification = {
            status: 'verified',
            checks: fc.results.map((r) => ({
              atom_text: r.sentence,
              verdict: r.verdict,
              ...(r.evidenceUrl ? { evidence_url: r.evidenceUrl } : {}),
              ...(r.correction ? { correction: r.correction } : {}),
            })),
          };
        }
      }
      if (budget <= 0) break;
    }
    log.info('book factcheck enrich (CSE+Haiku)', {
      mandalaId,
      sectionsChecked,
      atomsBudgetUsed: MAX_FACTCHECK_ATOMS - budget,
    });
  } catch (err) {
    log.warn('book factcheck enrich failed (non-fatal)', {
      mandalaId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
