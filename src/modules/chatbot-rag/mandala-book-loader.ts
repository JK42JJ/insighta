/**
 * src/modules/chatbot-rag/mandala-book-loader.ts
 *
 * Block I source — compact summary of the mandala's generated book index.
 *
 * The full `mandala_books.book_json` blob can run 50-200 KB (chapters →
 * sections → atoms). We only surface chapter titles + section titles +
 * atom counts to the chatbot — enough for "어느 챕터에 그게 있어?" type
 * navigation queries without bloating the prompt. The chatbot can ask
 * follow-ups against video context for atom-level detail.
 *
 * Failures degrade silently to `null` (no book row, malformed JSON, DB
 * unreachable).
 */

import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import {
  MAX_BOOK_CHAPTERS,
  MAX_BOOK_SECTIONS_PER_CHAPTER,
  type MandalaBookContext,
  type MandalaBookChapterSummary,
} from './types';

const log = logger.child({ module: 'chatbot-rag/mandala-book-loader' });

export interface LoadMandalaBookParams {
  mandalaId: string;
}

interface RawAtom {
  vid?: unknown;
  ts?: unknown;
  text?: unknown;
}

interface RawSection {
  title?: unknown;
  narrative?: unknown;
  atoms?: unknown;
}

interface RawChapter {
  ch?: unknown;
  title?: unknown;
  intro?: unknown;
  sections?: unknown;
}

interface RawBook {
  mandala_title?: unknown;
  source_videos?: unknown;
  source_atoms?: unknown;
  chapters?: unknown;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export async function loadMandalaBook(
  params: LoadMandalaBookParams
): Promise<MandalaBookContext | null> {
  if (!params.mandalaId) return null;
  const prisma = getPrismaClient();

  try {
    // Prisma client model name is `mandala_books`; use raw query because
    // the FE/BE schema's name has historically diverged (see
    // mandalas.ts:2758 same workaround). Keeps this loader robust against
    // future Prisma schema regenerations.
    const rows = await prisma.$queryRawUnsafe<Array<{ book_json: unknown }>>(
      'SELECT book_json FROM public.mandala_books WHERE mandala_id = $1::uuid LIMIT 1',
      params.mandalaId
    );
    if (rows.length === 0) return null;

    const raw = rows[0]?.book_json as RawBook | null | undefined;
    if (!raw || typeof raw !== 'object') return null;

    const chaptersRaw = Array.isArray(raw.chapters) ? (raw.chapters as RawChapter[]) : [];

    // Walk ALL chapters/sections/atoms (not just the truncated prefix) to
    // collect the full set of unique video ids — Block I's video count is
    // the user-facing "N개 영상" sidebar mirror, so undercounting because
    // of MAX_BOOK_CHAPTERS would surface as wrong-count answers.
    const videoIdSet = new Set<string>();
    for (const rc of chaptersRaw) {
      const secs = Array.isArray(rc.sections) ? (rc.sections as RawSection[]) : [];
      for (const rs of secs) {
        const atoms = Array.isArray(rs.atoms) ? (rs.atoms as RawAtom[]) : [];
        for (const atom of atoms) {
          if (typeof atom.vid === 'string' && atom.vid.length > 0) {
            videoIdSet.add(atom.vid);
          }
        }
      }
    }
    const bookVideoIds = Array.from(videoIdSet);

    // Resolve titles in one batch (capped at the same size as
    // MAX_MANDALA_CARDS-ish). Failure → empty titles array; count still
    // surfaces via book_video_ids.length.
    let bookVideoTitles: string[] = [];
    if (bookVideoIds.length > 0) {
      try {
        const videoRows = await prisma.youtube_videos.findMany({
          where: { youtube_video_id: { in: bookVideoIds } },
          select: { youtube_video_id: true, title: true },
        });
        // Preserve the original collection order so the chatbot's listing
        // matches how the user would read the book index top-down.
        const titleByVid = new Map(videoRows.map((r) => [r.youtube_video_id, r.title] as const));
        bookVideoTitles = bookVideoIds
          .map((vid) => titleByVid.get(vid))
          .filter((t): t is string => typeof t === 'string' && t.length > 0);
      } catch (titleErr) {
        log.warn('mandala-book-loader: youtube_videos title fetch failed; skipping titles', {
          error: titleErr instanceof Error ? titleErr.message : String(titleErr),
        });
      }
    }

    const chapters: MandalaBookChapterSummary[] = chaptersRaw
      .slice(0, MAX_BOOK_CHAPTERS)
      .map((rc) => {
        const sectionsRaw = Array.isArray(rc.sections) ? (rc.sections as RawSection[]) : [];
        const sections = sectionsRaw
          .slice(0, MAX_BOOK_SECTIONS_PER_CHAPTER)
          .map((rs) => ({
            title: asString(rs.title) ?? '(제목 없음)',
            atom_count: Array.isArray(rs.atoms) ? (rs.atoms as RawAtom[]).length : 0,
          }))
          .filter((s) => s.title !== '(제목 없음)' || s.atom_count > 0);

        const chapter: MandalaBookChapterSummary = {
          ch: asNumber(rc.ch, 0),
          title: asString(rc.title) ?? '(제목 없음)',
          sections,
        };
        const intro = asString(rc.intro);
        if (intro) chapter.intro = intro;
        return chapter;
      })
      .filter((c) => c.title !== '(제목 없음)' || c.sections.length > 0);

    return {
      mandala_id: params.mandalaId,
      mandala_title: asString(raw.mandala_title) ?? '',
      source_videos: asNumber(raw.source_videos, 0),
      source_atoms: asNumber(raw.source_atoms, 0),
      chapters,
      book_video_ids: bookVideoIds,
      book_video_titles: bookVideoTitles,
    };
  } catch (err) {
    log.warn('mandala-book-loader query failed', {
      mandalaId: params.mandalaId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
