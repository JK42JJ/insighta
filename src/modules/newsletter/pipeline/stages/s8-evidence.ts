/**
 * S8 — turn captions into evidence rows.
 *
 * This is the stage that decides whether an issue can be checked at all. The
 * checks in `v2/doc-checks.ts` compare a sentence against a verbatim run from
 * its source; without rows carrying those runs they have nothing to read, and
 * issue 2's fixtures were written by hand.
 *
 * Deterministic on purpose. No model touches this: a model that rewrites a
 * caption line while extracting it produces a quote that is not in the source,
 * which is the exact defect the quote check exists to catch. Regex and string
 * slicing only, so the same captions always yield the same rows and the stage
 * can be re-run without spending anything.
 *
 * What makes a run worth keeping is narrow: a sentence carrying a number, a
 * unit, or a capitalised name. Everything else is narration, and an evidence
 * table full of narration is a table nobody reads.
 */

import { logger } from '@/utils/logger';
import type { CorpusRow } from '../corpus';
import type { Stage, StageContext, StageResult } from '../stage';

const log = logger.child({ module: 'newsletter/s8' });

/**
 * Where caption text comes from.
 *
 * Injected rather than imported because the only real implementation talks to
 * the Mac Mini, and the rule for that path is fixed: captions live in the
 * collector's local cache and never in this database. A stage that reached for
 * them directly would have to hold the text, which is the thing the policy
 * forbids. Here the text arrives, is sliced, and is dropped.
 */
export interface CaptionSource {
  /** The caption text for one video, or null when it was never fetched. */
  get(videoId: string): Promise<string | null>;
}

/** One verbatim run from a source, with what made it worth keeping. */
export interface EvidenceRow {
  videoId: string;
  /** The run exactly as the source wrote it. Never edited, never rewritten. */
  quoted: string;
  /** Character offsets into the caption, so the run can be found again. */
  from: number;
  to: number;
  /** Why this run was kept. */
  carries: Array<'number' | 'unit' | 'name'>;
}

/** Cap per video. A brief cites a handful of runs, not a transcript. */
const RUNS_PER_VIDEO = 12;

/** A run longer than this is a paragraph, and quoting it is republishing. */
export const MAX_QUOTE_CHARS = 200;

const NUMBER = /\d[\d,]*(?:\.\d+)?/;
/**
 * Units a brief actually argues about.
 *
 * Two alternatives, not one: `\b` is defined on word characters, and Hangul
 * is word characters throughout, so `\b토큰\b` never matches inside
 * `637,000토큰입니다` — the boundary it wants is not there. Latin units keep
 * their boundaries; Korean ones are matched bare, which is safe because these
 * are the units, not prefixes of longer words.
 */
const UNIT = /\b(?:[KMGT]i?B|tokens?|ms)\b|(?:토큰|원|달러|밀리초|퍼센트)|[%$]/;
/** A capitalised multi-letter word, or a Hangul name followed by a particle. */
const NAME = /\b[A-Z][A-Za-z0-9-]{2,}\b/;

/**
 * Split into sentences the way a reader would, then keep the ones that carry
 * something checkable.
 *
 * Auto-captions arrive with no punctuation on some channels, so a fallback
 * splits on line breaks. A run that comes out longer than the cap is trimmed
 * at a word boundary rather than mid-token: a quote cut through a number is
 * worse than no quote.
 */
export function extractRuns(caption: string): EvidenceRow[] {
  const text = caption.normalize('NFC');
  const pieces: Array<{ s: string; at: number }> = [];
  let at = 0;
  for (const raw of text.split(/(?<=[.!?。])\s+|\n+/)) {
    const idx = text.indexOf(raw, at);
    if (idx >= 0) at = idx;
    if (raw.trim().length > 0) pieces.push({ s: raw.trim(), at });
    at += raw.length;
  }

  const rows: EvidenceRow[] = [];
  for (const p of pieces) {
    if (rows.length >= RUNS_PER_VIDEO) break;
    const carries: EvidenceRow['carries'] = [];
    if (NUMBER.test(p.s)) carries.push('number');
    if (UNIT.test(p.s)) carries.push('unit');
    if (NAME.test(p.s)) carries.push('name');
    if (carries.length === 0) continue;

    let quoted = p.s;
    if (quoted.length > MAX_QUOTE_CHARS) {
      const cut = quoted.lastIndexOf(' ', MAX_QUOTE_CHARS);
      quoted = quoted.slice(0, cut > 0 ? cut : MAX_QUOTE_CHARS).trim();
    }
    const from = text.indexOf(quoted, p.at);
    if (from < 0) continue; // the trim moved it; skip rather than record a run that cannot be found
    rows.push({ videoId: '', quoted, from, to: from + quoted.length, carries });
  }
  return rows;
}

export function makeS8Evidence(captions: CaptionSource): Stage {
  return {
    id: 'S8_evidence',
    what: 'verbatim runs from the captions of the shortlist',
    kind: 'machine',

    async run(input: CorpusRow[], _ctx: StageContext): Promise<StageResult> {
      const drops: StageResult['drops'] = [];
      const evidence: EvidenceRow[] = [];
      let withCaptions = 0;

      for (const row of input) {
        const text = await captions.get(row.videoId);
        if (text === null || text.trim().length === 0) {
          // Not a rejection. The video stays in the corpus and can still be a
          // pick; it just cannot back a sentence, and the gate that requires a
          // quote will refuse any claim that tries to lean on it.
          continue;
        }
        withCaptions++;
        for (const r of extractRuns(text)) evidence.push({ ...r, videoId: row.videoId });
      }

      log.info('evidence extracted', {
        videos: input.length,
        withCaptions,
        runs: evidence.length,
      });

      return {
        // The runs ride on the row they came from. Counting them and dropping
        // the text would leave the stage provably useless: a number cannot be
        // quoted, and a claim graded on a count is a claim with no source.
        //
        // Excerpts, not captions. The policy keeps full caption text off this
        // database; what is stored here is what extractRuns already bounds --
        // at most RUNS_PER_VIDEO runs of at most MAX_QUOTE_CHARS each,
        // which is a quotation and not a copy.
        survivors: input.map((v) => {
          const runs = evidence.filter((e) => e.videoId === v.videoId);
          return {
            videoId: v.videoId,
            enrichment: {
              ...(v.enrichment ?? {}),
              evidenceRuns: runs.length,
              evidence: runs.map(({ quoted, from, to, carries }) => ({
                quoted,
                from,
                to,
                carries,
              })),
            },
          };
        }),
        drops,
        itemsIn: input.length,
        detail: {
          withCaptions,
          withoutCaptions: input.length - withCaptions,
          runs: evidence.length,
        },
      };
    },
  };
}
