// Book-index (mandala_books.book_json) v2 contract.
//
// SSOT for the per-mandala distilled book index. The book stays a JSONB blob
// on mandala_books.book_json (normalization deferred — prod legacy is 1 row,
// 4 consumers read the blob whole). This zod schema is the shape the auto-fill
// (살붙임) job MUST emit and the validator a write path SHOULD run before upsert.
//
// Granularity note: book sections are THEMATIC (chapter -> section -> atoms),
// distinct from video_rich_summaries.segments.sections which are time-ranges.
// Book atoms carry {vid, ts} back-links to video timestamps; an optional
// seg_ref ties an atom to the rich-summary time-segment it was distilled from.

import { z } from 'zod';

const YT_ID = z.string().min(1).max(11);

/** Atom = one standalone insight, linked to a source video timestamp. */
export const bookAtomSchema = z.object({
  vid: YT_ID,
  ts: z.number().int().min(0),
  text: z.string(),
  // Optional — unused in current prod data (0/98 rows); kept for generator freedom.
  type: z.string().optional(),
  // Optional back-link to the rich_summary time-segment this atom came from.
  // Travels by time coords because rich_summary sections[] index is unstable
  // across regeneration (see video_mandala_segment_relevance migration).
  seg_ref: z
    .object({ from_sec: z.number().int().min(0), to_sec: z.number().int().min(0) })
    .optional(),
});

const bookQaSchema = z.object({ q: z.string(), a: z.string() });

/** Fork D placeholders — reserved fields, fill job not implemented (v1 scope = skeleton + body only). */
const provenanceSchema = z
  .object({
    video_ids: z.array(YT_ID).default([]),
    rich_summary_versions: z.array(z.string()).default([]),
  })
  .nullish();

// CP504 loop-2-A (A1) — per-atom factcheck stored ADDITIVELY in section.verification.
// Atoms are the sourced fact units; the woven prose is NOT rewritten — `correction`
// is a PROPOSAL only. Optional → books without it stay valid.
const factcheckCheckSchema = z.object({
  atom_text: z.string(),
  verdict: z.enum(['TRUE', 'SUBSTANTIALLY_TRUE', 'FALSE', 'MISLEADING', 'UNVERIFIABLE']),
  evidence_url: z.string().optional(),
  correction: z.string().optional(), // proposal only (FALSE/MISLEADING, evidence-grounded)
});

const verificationSchema = z
  .object({
    status: z.enum(['unverified', 'verified', 'flagged']).default('unverified'),
    notes: z.string().optional(),
    checks: z.array(factcheckCheckSchema).optional(), // CP504 loop-2-A factcheck proposals
  })
  .nullish();

// CP505 [CV-NOTE-WIRE] — targeted CV figures attached to a section (ADDITIVE).
// Sourced from the slidegen /numerize service (cached in video_figure_snapshots),
// mirroring snapshot FigureRef. The note CV enrich job stores ONLY verified,
// renderable kinds (chart/table/diagram/equation); keyframe + unverified dropped.
// Optional → books without CV stay valid. Render: chart/diagram→SVG (svg field),
// table→HTML (struct), equation→KaTeX (latex). asset_path kept for legacy rows.
const bookFigureSchema = z.object({
  video_id: z.string(),
  ts_sec: z.number().int(),
  kind: z.enum(['chart', 'diagram', 'table', 'equation', 'keyframe']),
  latex: z.string().optional(), // equation → LaTeX (KaTeX render)
  asset_path: z.string().optional(), // legacy image pointer (no longer written by enrich job)
  struct: z.record(z.unknown()).optional(), // mode-B JSON (chart/table/diagram)
  svg: z.string().optional(), // chart/diagram → SVG from /render-figure (CP505 struct→SVG)
  verification_status: z.string().optional(),
});

export const bookSectionSchema = z.object({
  title: z.string(),
  // Rich markdown: **bold** on key terms/numbers, bullet/numbered lists, callouts,
  // mermaid blocks, GFM tables, prose paragraphs. FE parses into TipTap nodes.
  narrative: z.string(),
  // NOTE-DENSITY ① (back-compat) — bullet take-away array from PR #1017 design.
  // Kept optional; generation now fills keyPoint (singular prose synthesis) instead.
  keyPoints: z.array(z.string()).optional(),
  // NOTE-DENSITY ①-v2 — 2-3 sentence prose synthesis (the "핵심 포인트" quote).
  // Rendered as a left-bar QUOTE block. Optional: absent ⇒ nothing rendered;
  // existing books without this field stay valid.
  keyPoint: z.string().optional(),
  atoms: z.array(bookAtomSchema).default([]),
  qa: z.array(bookQaSchema).default([]),
  provenance: provenanceSchema, // Fork D placeholder
  verification: verificationSchema, // Fork D placeholder
  figures: z.array(bookFigureSchema).optional(), // CP505 [CV-NOTE-WIRE] (additive)
});

// CP504 loop-2-B — STORM gap-fill findings attached to a chapter (additive).
// Each fact carries a ref_id into book.references[] (web provenance). Optional.
const chapterResearchSchema = z.object({
  perspective: z.string(),
  fact: z.string(),
  ref_id: z.number().int(),
});

export const bookChapterSchema = z.object({
  ch: z.number().int(),
  title: z.string(),
  intro: z.string(),
  sections: z.array(bookSectionSchema),
  research: z.array(chapterResearchSchema).optional(), // CP504 loop-2-B (additive)
});

// CP504 loop-2-B (B) — web references from STORM research. Video provenance stays
// inline on atoms (atom.vid/ts); this is the WEB half of dual-source tracking
// (P-REF-DUAL). Rendered as a bottom "참고 자료" section. Optional → legacy valid.
const bookReferenceSchema = z.object({
  id: z.number().int(),
  title: z.string(),
  url: z.string(),
});

export const bookJsonSchema = z.object({
  // NEW in v2 — drives validation + future migration. Existing PoC rows (no
  // schema_version) are treated as legacy v1 by callers before this validator.
  schema_version: z.literal(2),
  mandala_id: z.string().uuid(),
  mandala_title: z.string(),
  generated_at: z.string(),
  // source_videos = count of source videos distilled into this book.
  source_videos: z.number().int().min(0),
  // source_atoms = total INPUT atom pool harvested from those videos' v2
  // summaries — NOT the count of atoms included in the book (curated subset
  // is smaller; observed prod row: 213 input vs 98 included).
  source_atoms: z.number().int().min(0),
  estimated_pages: z.number().int().min(0).optional(),
  stats: z.record(z.unknown()).optional(),
  // Fork D placeholder — book-level completeness, fill job not implemented.
  completeness: z.object({ status: z.string(), checked_at: z.string() }).nullish(),
  chapters: z.array(bookChapterSchema),
  references: z.array(bookReferenceSchema).optional(), // CP504 loop-2-B web refs (additive)
});

/** Pre-parse input shape (defaults + Fork-D placeholders optional) — for fixtures/generators. */
export type BookJsonInput = z.input<typeof bookJsonSchema>;
export type BookAtom = z.infer<typeof bookAtomSchema>;
export type BookSection = z.infer<typeof bookSectionSchema>;
export type BookChapter = z.infer<typeof bookChapterSchema>;
export type BookFigure = z.infer<typeof bookFigureSchema>;
export type BookJson = z.infer<typeof bookJsonSchema>;

/** Throws ZodError on shape violation — call before upserting a generated book. */
export function parseBookJson(input: unknown): BookJson {
  return bookJsonSchema.parse(input);
}

/** Non-throwing variant for read paths that must tolerate legacy/partial rows. */
export function safeParseBookJson(input: unknown): z.SafeParseReturnType<unknown, BookJson> {
  return bookJsonSchema.safeParse(input);
}
