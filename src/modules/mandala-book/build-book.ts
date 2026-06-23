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
import type { TopicSection } from './topic-synthesis';
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
  // §1⑤ topic synthesis output (set by fill-book when enabled). Present ⇒
  // sections are built per-topic (content), resolving atom_refs against `videos`.
  // Absent ⇒ legacy one-section-per-video. build-book stays pure either way.
  topics?: TopicSection[];
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
 * v2 atoms (with a real timestamp) → book atoms. NO interpolation: atoms without
 * a timestamp are skipped (book atom.ts is required). Shared by both assembly
 * modes so a book atom is built identically whether grouped by video or topic.
 */
function bookAtomsForVideo(video: CellVideoV2) {
  const segments = video.segments;
  return (segments?.atoms ?? [])
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
}

/**
 * Assemble book_json from mandala cells + their v2 summaries. Pure: same input
 * → same output (NO LLM here — topic synthesis runs upstream in fill-book and
 * arrives as cell.topics). Returns the book plus the two source counters.
 */
export function buildBookJson(input: BuildBookInput): BuildBookResult {
  let sourceVideos = 0;
  let sourceAtoms = 0;

  const chapters = input.cells.map((cell) => {
    // Source counters (both modes draw from the same videos/atoms pool).
    for (const v of cell.videos) {
      sourceVideos += 1;
      sourceAtoms += v.segments?.atoms?.length ?? 0; // input pool: every harvested atom
    }

    let sections;
    if (cell.topics && cell.topics.length > 0) {
      // TOPIC mode (§1⑤): one section per CONTENT topic (not per video). Resolve
      // synthesis atom_refs {vid,ts} → full book atoms from this cell's videos —
      // provenance preserved, so figure/relevance (keyed on {vid,ts}) travel with
      // the topic. narrative = the topic summary (light synthesis, no fabrication);
      // qa = gathered from the topic's source videos.
      const atomByKey = new Map<string, ReturnType<typeof bookAtomsForVideo>[number]>();
      const qaByVid = new Map<string, Array<{ q: string; a: string }>>();
      for (const v of cell.videos) {
        for (const a of bookAtomsForVideo(v)) atomByKey.set(`${a.vid}:${a.ts}`, a);
        qaByVid.set(
          v.videoId,
          (v.lora?.qa_pairs ?? []).map((p) => ({ q: p.q, a: p.a }))
        );
      }
      sections = cell.topics.map((topic) => {
        const atoms = topic.atom_refs
          .map((r) => atomByKey.get(`${r.vid}:${r.ts}`))
          .filter((a): a is NonNullable<typeof a> => a != null);
        const vids = Array.from(new Set(topic.atom_refs.map((r) => r.vid)));
        const qa = vids.flatMap((v) => qaByVid.get(v) ?? []);
        return { title: topic.topic_title, narrative: topic.summary, atoms, qa };
      });
    } else {
      // LEGACY mode: one section per video (synthesis off/failed → safe fallback;
      // byte-identical to pre-§1⑤ output).
      sections = cell.videos.map((video) => ({
        title: video.title,
        narrative: assembleNarrative(video),
        atoms: bookAtomsForVideo(video),
        // qa: v2 lora.qa_pairs are all context='video'; map as-is to {q,a}.
        qa: (video.lora?.qa_pairs ?? []).map((p) => ({ q: p.q, a: p.a })),
      }));
    }

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
