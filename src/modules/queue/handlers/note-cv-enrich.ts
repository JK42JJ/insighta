/**
 * Note visual-CV enrich worker (CP505 [CV-NOTE-WIRE]).
 *
 * Async job: load book_json → Haiku detects figure targets in sections →
 * getOrExtractSnapshots per video → filter renderable kinds (chart/table/diagram/
 * equation, drop keyframe + unverified) → attach BookFigure to section.figures
 * (additive) → re-validate → write back. Flag-gated (VISUAL_CV_ENABLED); inert
 * when SNAPSHOT_SERVICE_TOKEN is unset (getOrExtractSnapshots returns [] gracefully).
 *
 * Never blocks the fill path — triggered fire-and-forget from fill-book.ts.
 */

import PgBoss from 'pg-boss';
import { logger } from '@/utils/logger';
import { getJobQueue } from '../manager';
import { JOB_NAMES, NOTE_CV_ENRICH_OPTIONS, type NoteCvEnrichPayload } from '../types';
import { richSummaryWorkOptions } from './rich-summary-work-options';
import type { BookFigure } from '@/modules/mandala-book/book-schema';

const log = logger.child({ module: 'queue/note-cv-enrich' });

// Trap-proof option shape (teamSize:N + teamRefill) so raising this later parallelizes.
const NOTE_CV_ENRICH_CONCURRENCY = 2;

// Renderable kinds the renderer supports; keyframe is binary-only (deferred).
const RENDERABLE_KINDS = new Set<string>(['chart', 'table', 'diagram', 'equation']);

// numerize returns a figure within ±NUMERIZE_WINDOW_SEC (slidegen=10s) of a requested
// ts, so the figure's ACTUAL ts (slide-display time) rarely equals the target ts
// (subtitle/atom time). Match within this window, not exact ts. = slidegen NUMERIZE_WINDOW_SEC.
const FIGURE_TS_WINDOW_SEC = 10;

export async function registerNoteCvEnrichWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();
  await boss.work<NoteCvEnrichPayload>(
    JOB_NAMES.NOTE_CV_ENRICH,
    richSummaryWorkOptions(NOTE_CV_ENRICH_CONCURRENCY),
    handleNoteCvEnrich
  );
  log.info('note-cv-enrich worker registered', { concurrency: NOTE_CV_ENRICH_CONCURRENCY });
}

export async function handleNoteCvEnrich(job: PgBoss.Job<NoteCvEnrichPayload>): Promise<void> {
  const { mandalaId, userId } = job.data ?? ({} as NoteCvEnrichPayload);
  if (!mandalaId || !userId) {
    log.warn('note-cv-enrich: mandalaId/userId 누락, 드롭', { jobId: job.id });
    return;
  }

  const startMs = Date.now();

  // Lazy imports keep the queue boot path free of the enrichment chain.
  const { getPrismaClient } = await import('@/modules/database/client');
  const { safeParseBookJson, parseBookJson } = await import('@/modules/mandala-book/book-schema');
  const { detectFigureTargets } = await import('@/modules/mandala-book/book-figure-detect');
  const { getOrExtractSnapshots } = await import('@/modules/snapshot/get-or-extract');
  const { renderFigureSvg } = await import('@/modules/snapshot/render-figure-client');

  const prisma = getPrismaClient();

  // a. Load book_json (parse with parseBookJson contract).
  const bookRow = await prisma.mandala_books.findUnique({
    where: { mandala_id: mandalaId },
    select: { book_json: true },
  });
  if (!bookRow?.book_json) {
    log.warn('note-cv-enrich: book_json 없음', { jobId: job.id, mandalaId });
    return;
  }

  const parsed = safeParseBookJson(bookRow.book_json);
  if (!parsed.success) {
    log.warn('note-cv-enrich: book_json 스키마 오류', { jobId: job.id, mandalaId });
    return;
  }
  const book = parsed.data;
  const centerGoal = book.mandala_title;

  // b. Detect figure targets via one Haiku call.
  const targets = await detectFigureTargets(book, { centerGoal });
  if (targets.length === 0) {
    log.info('note-cv-enrich: 감지된 타겟 없음', { mandalaId, wallMs: Date.now() - startMs });
    return;
  }

  // c. Group targets by videoId, then call getOrExtractSnapshots per video.
  const targetsByVideo = new Map<string, typeof targets>();
  for (const t of targets) {
    const bucket = targetsByVideo.get(t.videoId) ?? [];
    bucket.push(t);
    targetsByVideo.set(t.videoId, bucket);
  }

  let cacheHits = 0;
  let extractCount = 0;
  let kept = 0;
  let dropped = 0;
  let droppedNoSvg = 0; // chart/diagram where /render-figure returned null (degenerate)
  let svgRendered = 0; // chart/diagram that got a valid SVG
  let totalCalls = 0;

  for (const [videoId, videoTargets] of targetsByVideo) {
    const tsList = videoTargets.map((t) => t.tsSec);
    totalCalls += tsList.length;
    const refs = await getOrExtractSnapshots(videoId, tsList);

    for (const fig of refs) {
      if (fig.source === 'cache') cacheHits++;
      else extractCount++;

      // d. Filter: renderable kinds only, drop unverified.
      if (!RENDERABLE_KINDS.has(fig.kind) || fig.verificationStatus === 'unverified') {
        dropped++;
        continue;
      }

      // Map FigureRef → BookFigure (struct narrowed from unknown to Record<string,unknown>).
      const struct =
        typeof fig.struct === 'object' && fig.struct !== null && !Array.isArray(fig.struct)
          ? (fig.struct as Record<string, unknown>)
          : undefined;

      // chart/diagram: require a rendered SVG (struct→SVG via /render-figure).
      // table: renders from struct (HTML); equation: renders from latex (KaTeX).
      // asset_path is no longer written — struct/svg/latex is the canonical base.
      let figSvg: string | undefined;
      if (fig.kind === 'chart' || fig.kind === 'diagram') {
        const svg = await renderFigureSvg(fig.kind, fig.struct);
        if (svg === null) {
          // Degenerate figure — no usable SVG; drop rather than attach an empty entry.
          droppedNoSvg++;
          continue;
        }
        figSvg = svg;
        svgRendered++;
      }

      kept++;

      const bookFig: BookFigure = {
        video_id: fig.videoId,
        ts_sec: fig.tsSec,
        kind: fig.kind,
        ...(fig.latex != null ? { latex: fig.latex } : {}),
        ...(struct != null ? { struct } : {}),
        ...(figSvg !== undefined ? { svg: figSvg } : {}),
        verification_status: fig.verificationStatus,
      };

      // e. Attach to section.figures — additive, dedup by (video_id, ts_sec).
      // Figure ts (actual slide location) ≠ target ts (subtitle time) but is within
      // numerize's ±window → match the NEAREST target in that window. Exact-ts match
      // dropped every figure (e.g. figure@184 vs target 150/190 → 0 attached → book 0).
      const inWindow = videoTargets.filter(
        (t) => Math.abs(t.tsSec - fig.tsSec) <= FIGURE_TS_WINDOW_SEC
      );
      const matching = inWindow.length
        ? [
            inWindow.reduce((a, b) =>
              Math.abs(a.tsSec - fig.tsSec) <= Math.abs(b.tsSec - fig.tsSec) ? a : b
            ),
          ]
        : [];
      for (const target of matching) {
        const ch = book.chapters[target.chapterIdx];
        if (!ch) continue;
        const sec = ch.sections[target.sectionIdx];
        if (!sec) continue;
        const alreadyPresent = (sec.figures ?? []).some(
          (f) => f.video_id === bookFig.video_id && f.ts_sec === bookFig.ts_sec
        );
        if (alreadyPresent) continue;
        if (!sec.figures) sec.figures = [];
        sec.figures.push(bookFig);
      }
    }
  }

  // g. LOG in Korean per project style: calls, cache-hit/extract ratio, wall-time, kept/dropped.
  const wallMs = Date.now() - startMs;
  log.info('note-cv-enrich 완료', {
    mandalaId,
    totalCalls,
    cacheHits,
    extractCount,
    kept,
    dropped,
    droppedNoSvg,
    svgRendered,
    wallMs,
  });

  if (kept === 0) return; // Nothing to write back.

  // f. Bump generated_at, re-validate with parseBookJson before write.
  book.generated_at = new Date().toISOString();
  let validated;
  try {
    validated = parseBookJson(book);
  } catch (err) {
    log.error('note-cv-enrich: 재검증 실패 — 저장 취소', {
      mandalaId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // Raw SQL — mirrors fill-book.ts upsert note about Prisma model lag on some deploys.
  await prisma.$executeRawUnsafe(
    `UPDATE mandala_books
     SET book_json  = $1::jsonb,
         updated_at = NOW()
     WHERE mandala_id = $2::uuid`,
    JSON.stringify(validated),
    mandalaId
  );

  log.info('note-cv-enrich book_json 저장 완료', { mandalaId, figuresKept: kept });
}

/** Enqueue a note-cv-enrich job for one mandala. Returns the pg-boss job id (or null). */
export async function enqueueNoteCvEnrich(
  mandalaId: string,
  userId: string
): Promise<string | null> {
  const boss = getJobQueue().getInstance();
  return boss.send(JOB_NAMES.NOTE_CV_ENRICH, { mandalaId, userId }, NOTE_CV_ENRICH_OPTIONS);
}
