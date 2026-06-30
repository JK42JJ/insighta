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
import type { BookSkeleton } from './book-skeleton';
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
  // §4.5.1 [2] narrative skeleton (set by fill-book when enabled). When present,
  // chapters are built FROM the skeleton (cross-cell narrative grouping + intro),
  // NOT cell→chapter 1:1. topic_refs index the flat topic list (cells in order,
  // each cell's `topics` flattened) — the SAME order fill-book used to build the
  // skeleton input. Absent ⇒ legacy cell=chapter assembly (byte-unchanged).
  skeleton?: BookSkeleton;
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

type BookAtom = ReturnType<typeof bookAtomsForVideo>[number];

/** Index a set of videos' atoms by `${vid}:${ts}` + qa by vid. Shared by cell
 *  (per-cell) and skeleton (global cross-cell) assembly so resolution matches. */
function indexVideos(videos: CellVideoV2[]): {
  atomByKey: Map<string, BookAtom>;
  qaByVid: Map<string, Array<{ q: string; a: string }>>;
} {
  const atomByKey = new Map<string, BookAtom>();
  const qaByVid = new Map<string, Array<{ q: string; a: string }>>();
  for (const v of videos) {
    for (const a of bookAtomsForVideo(v)) atomByKey.set(`${a.vid}:${a.ts}`, a);
    qaByVid.set(
      v.videoId,
      (v.lora?.qa_pairs ?? []).map((p) => ({ q: p.q, a: p.a }))
    );
  }
  return { atomByKey, qaByVid };
}

/**
 * Resolve one synthesized topic → a book section. Atoms resolve from {vid,ts}
 * (provenance preserved); near-dup atoms (v2 sometimes emits N copies of one
 * sentence) and identical qa are deduped. Shared by cell-topic mode and skeleton
 * mode so a section is built identically whichever grouping produced it.
 */
function sectionFromTopic(
  topic: TopicSection,
  atomByKey: Map<string, BookAtom>,
  qaByVid: Map<string, Array<{ q: string; a: string }>>
) {
  const resolved = topic.atom_refs
    .map((r) => atomByKey.get(`${r.vid}:${r.ts}`))
    .filter((a): a is NonNullable<typeof a> => a != null);
  const seenAtom = new Set<string>();
  const atoms = resolved.filter((a) => {
    const k = a.text.trim();
    if (seenAtom.has(k)) return false;
    seenAtom.add(k);
    return true;
  });
  const vids = Array.from(new Set(topic.atom_refs.map((r) => r.vid)));
  const seenQa = new Set<string>();
  const qa = vids
    .flatMap((v) => qaByVid.get(v) ?? [])
    .filter((p) => {
      const k = `${p.q} ${p.a}`;
      if (seenQa.has(k)) return false;
      seenQa.add(k);
      return true;
    });
  return {
    title: topic.topic_title,
    narrative: topic.summary,
    // NOTE-DENSITY ① — pass through keyPoints written by book-body weave step.
    ...(topic.keyPoints && topic.keyPoints.length > 0 ? { keyPoints: topic.keyPoints } : {}),
    atoms,
    qa,
  };
}

/**
 * Assemble book_json from mandala cells + their v2 summaries. Pure: same input
 * → same output (NO LLM here — topic synthesis + narrative skeleton run upstream
 * in fill-book and arrive as cell.topics / input.skeleton). Returns the book plus
 * the two source counters.
 *
 * Two assemblies: skeleton present ⇒ chapters from the narrative skeleton
 * (cross-cell grouping + intro, §4.5.1); absent ⇒ legacy cell=chapter (1:1).
 */
/**
 * §4.5.1 skeleton assembly — chapters come from the narrative skeleton
 * (cross-cell grouping + populated intro), NOT cell=chapter. Pure, like its
 * sibling: the LLM ran upstream (book-skeleton.ts), here we only resolve.
 */
function buildBookFromSkeleton(input: BuildBookInput): BuildBookResult {
  let sourceVideos = 0;
  let sourceAtoms = 0;
  for (const cell of input.cells) {
    for (const v of cell.videos) {
      sourceVideos += 1;
      sourceAtoms += v.segments?.atoms?.length ?? 0; // input pool: every harvested atom
    }
  }
  // Flat topic list = cells in order, each cell's topics flattened (the SAME
  // order fill-book used to build the skeleton input → topic_refs line up). The
  // atom/qa index is GLOBAL (across all cells) since a chapter merges cells.
  const flatTopics: TopicSection[] = input.cells.flatMap((c) => c.topics ?? []);
  const { atomByKey, qaByVid } = indexVideos(input.cells.flatMap((c) => c.videos));
  const chapters = (input.skeleton?.chapters ?? [])
    .map((schap, seq) => ({
      ch: seq, // sequential narrative order (NOT cell index)
      title: schap.title,
      intro: schap.intro, // §4.5.1 — populated narrative (legacy cell mode left this '')
      sections: schap.topic_refs
        .map((i) => flatTopics[i])
        .filter((t): t is TopicSection => t != null)
        .map((topic) => sectionFromTopic(topic, atomByKey, qaByVid)),
    }))
    // Drop a chapter whose topics all failed to resolve (honest skip).
    .filter((chapter) => chapter.sections.length > 0);

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

export function buildBookJson(input: BuildBookInput): BuildBookResult {
  // §4.5.1 — skeleton present ⇒ narrative assembly (cross-cell). Absent ⇒ the
  // legacy cell=chapter path below (byte-unchanged from pre-§4.5.1).
  if (input.skeleton) return buildBookFromSkeleton(input);

  let sourceVideos = 0;
  let sourceAtoms = 0;

  const chapters = input.cells
    .map((cell) => {
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
          const resolved = topic.atom_refs
            .map((r) => atomByKey.get(`${r.vid}:${r.ts}`))
            .filter((a): a is NonNullable<typeof a> => a != null);
          // CP504 §1⑤ surface-fix #1 — dedup provenance atoms by text. v2 sometimes
          // extracts one spoken sentence as N near-dup atoms; without this they render
          // verbatim N× under a single section (measured: "즐거운 주말" ×5). The first
          // {vid,ts} wins so figure/relevance links keyed on it still travel.
          const seenAtom = new Set<string>();
          const atoms = resolved.filter((a) => {
            const k = a.text.trim();
            if (seenAtom.has(k)) return false;
            seenAtom.add(k);
            return true;
          });
          const vids = Array.from(new Set(topic.atom_refs.map((r) => r.vid)));
          // qa is pooled across the topic's videos → dedup identical pairs too.
          const seenQa = new Set<string>();
          const qa = vids
            .flatMap((v) => qaByVid.get(v) ?? [])
            .filter((p) => {
              const k = `${p.q} ${p.a}`;
              if (seenQa.has(k)) return false;
              seenQa.add(k);
              return true;
            });
          return {
            title: topic.topic_title,
            narrative: topic.summary,
            // NOTE-DENSITY ① — carry keyPoints from the book-body weave step.
            ...(topic.keyPoints && topic.keyPoints.length > 0
              ? { keyPoints: topic.keyPoints }
              : {}),
            atoms,
            qa,
          };
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
    })
    // CP504 §1⑤ surface-fix #2 — drop chapters with no sections (cells lacking
    // usable-v2 videos). Render-filter ONLY: cell/placement rows are untouched, so
    // a re-fill re-includes the chapter once its videos enrich (idempotent).
    .filter((chapter) => chapter.sections.length > 0);

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
