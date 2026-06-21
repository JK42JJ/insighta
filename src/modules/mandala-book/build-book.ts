// Mandala book assembly — PURE, mechanical, NO LLM, NO DB.
//
// Distills already-generated v2 rich summaries into a mandala_books book_json.
// Every value here is a copy or string-concat of existing v2 fields — there is
// ZERO model inference in this module (no Anthropic/OpenRouter/Gemini import,
// no generation). The LLM work already happened when the v2 summaries were
// produced; this is assembly only. Interpolation is forbidden (hard rule):
// missing inputs are SKIPPED, never synthesized.
//
// Skeleton = mandala cells (§2-B decision 1): one chapter per cell (subject),
// one section per placed video that has a usable v2 summary. Honest skip:
// a cell with no usable videos yields an empty chapter (sections: []), a video
// atom without a timestamp yields no book atom (book atom.ts is required).

import type { BookJsonInput } from './book-schema';
import type {
  RichSummaryAnalysis,
  RichSummarySegments,
  RichSummaryLora,
} from '@/modules/skills/rich-summary-v2-prompt';

/** One placed video's already-parsed v2 columns (DB-fetched upstream). */
export interface CellVideoV2 {
  videoId: string; // 11-char YouTube id
  title: string;
  analysis: RichSummaryAnalysis | null;
  segments: RichSummarySegments | null;
  lora: RichSummaryLora | null;
}

/** One mandala cell + its usable-v2 videos (videos already filtered upstream). */
export interface CellInput {
  cellIndex: number; // 0..N-1, becomes chapter.ch
  title: string; // subject label / sub-goal, becomes chapter.title
  videos: CellVideoV2[];
}

export interface BuildBookInput {
  mandalaId: string;
  mandalaTitle: string;
  generatedAt: string; // ISO — passed in (pure fn stays deterministic/testable)
  cells: CellInput[];
}

export interface BuildBookResult {
  book: BookJsonInput;
  /** Videos actually placed into the book (= sections produced). */
  sourceVideos: number;
  /**
   * Total v2 atoms harvested from adopted videos BEFORE curation — the input
   * pool. Asymmetric with atoms actually in the book: atoms lacking a
   * timestamp_sec are counted here but skipped from the book (no interpolation),
   * so source_atoms >= included atoms (matches the observed 213 input vs 98
   * included). Kept distinct on purpose — see book-schema.ts source_atoms doc.
   */
  sourceAtoms: number;
}

/** Find the v2 segment window [from_sec, to_sec] that contains timestamp `t`. */
function segRefForTimestamp(
  segments: RichSummarySegments,
  t: number
): { from_sec: number; to_sec: number } | undefined {
  const sections = segments.sections ?? [];
  for (const s of sections) {
    if (
      typeof s.from_sec === 'number' &&
      typeof s.to_sec === 'number' &&
      t >= s.from_sec &&
      t <= s.to_sec
    ) {
      return { from_sec: s.from_sec, to_sec: s.to_sec };
    }
  }
  return undefined; // no containing window — omit seg_ref (optional), do not guess
}

/** Build a section's narrative by concatenating existing v2 text. NO generation. */
function assembleNarrative(video: CellVideoV2): string {
  const parts: string[] = [];
  const core = video.analysis?.core_argument;
  if (core && core.trim()) parts.push(core.trim());
  for (const s of video.segments?.sections ?? []) {
    if (s.summary && s.summary.trim()) parts.push(s.summary.trim());
  }
  return parts.join('\n\n'); // string join only — empty string is valid (schema allows "")
}

/**
 * Assemble book_json from mandala cells + their v2 summaries. Pure: same input
 * → same output. Returns the book plus the two source counters.
 */
export function buildBookJson(input: BuildBookInput): BuildBookResult {
  let sourceVideos = 0;
  let sourceAtoms = 0;

  const chapters = input.cells.map((cell) => {
    const sections = cell.videos.map((video) => {
      sourceVideos += 1;

      const segments = video.segments;
      const rawAtoms = segments?.atoms ?? [];
      sourceAtoms += rawAtoms.length; // input pool: every harvested atom counts

      // Book atoms = v2 atoms that have a real timestamp. Atoms without one are
      // skipped (book atom.ts is required; no interpolation of fake timestamps).
      const atoms = rawAtoms
        .filter((a) => typeof a.timestamp_sec === 'number')
        .map((a) => {
          const ts = a.timestamp_sec as number;
          const seg_ref = segments ? segRefForTimestamp(segments, ts) : undefined;
          return {
            vid: video.videoId,
            ts,
            text: a.text,
            ...(a.type ? { type: a.type } : {}),
            ...(seg_ref ? { seg_ref } : {}),
          };
        });

      // qa: v2 lora.qa_pairs are all context='video' (rich-summary-v2-prompt.ts
      // :268); map them as-is to the book's {q, a} shape. No context filter
      // (the handoff's 'mandala_cell' filter would drop every row — corrected
      // against code).
      const qa = (video.lora?.qa_pairs ?? []).map((p) => ({ q: p.q, a: p.a }));

      return {
        title: video.title,
        narrative: assembleNarrative(video),
        atoms,
        qa,
      };
    });

    return {
      ch: cell.cellIndex,
      title: cell.title,
      intro: '', // skeleton intro reserved; not synthesized (no LLM)
      sections, // empty array when the cell had no usable-v2 videos (honest skip)
    };
  });

  const book: BookJsonInput = {
    schema_version: 2,
    mandala_id: input.mandalaId,
    mandala_title: input.mandalaTitle,
    generated_at: input.generatedAt,
    source_videos: sourceVideos,
    source_atoms: sourceAtoms,
    chapters,
  };

  return { book, sourceVideos, sourceAtoms };
}
