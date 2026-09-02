/**
 * S5 — one channel is a claim; independent channels are an event.
 *
 * The rule issue 1 discovered by hand, written down so the next editor does
 * not rediscover it:
 *
 *   A subject carried by fewer than three independent channels is not written
 *   as fact. It is written as "this is circulating", or it is dropped.
 *
 * "Independent" means a different channel id, not a different video. Four
 * uploads from one channel are one source, and treating them as four is how a
 * brief turns a press release into a trend.
 *
 * The counting happens on the graph.
 *
 *   Two earlier versions counted text. The first keyed on literal terms and
 *   made the English and Korean words for one subject into two, so a story
 *   covered by two English channels and one Korean cleared nothing. The second
 *   fixed the aliases and hit the real problem: `agent` matched 144 of 274
 *   channels, every video reported the same number, and the signal that was
 *   supposed to rank the week ranked nothing.
 *
 *   The fault was the level, not the threshold. `agent` and `prompt-injection`
 *   are not peers, and a flat list cannot know that. The vocabulary now lives
 *   in the graph with `BROADER` edges, so this stage counts at the leaf and
 *   summarises at the branch: `prompt-injection` on eleven channels is an
 *   event, and `agent` on a hundred and forty-four is the subject of the brief.
 *
 * This stage drops nothing. Corroboration is a property of a subject, not a
 * reason a video is unfit — a single-source video can be the pick of the week
 * as long as the page says what it is.
 */

import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import type { CorpusRow } from '../corpus';
import type { Stage, StageContext, StageResult } from '../stage';
import {
  loadTaxonomy,
  syncConcepts,
  bridgeCorpus,
  EDITORIAL_OWNER,
  type Taxonomy,
} from '../ontology-bridge';

const log = logger.child({ module: 'newsletter/s5' });

/** Three independent channels is the bar. Below it, a claim is circulating. */
const INDEPENDENT_CHANNELS_REQUIRED = 3;

/**
 * A leaf on more than this share of the corpus's channels is the brief's
 * subject rather than the week's event, and is reported as background.
 *
 * Measured on the 2026-08-31 run: `agent` sat on 144 of 274 channels. A bar
 * that everything clears is not a bar.
 */
const BACKGROUND_SHARE = 0.25;

/**
 * How much of the corpus the vocabulary has to reach.
 *
 * Below this the graph is not describing the week — it is describing the part
 * of the week the file happens to know words for, and a page built on it would
 * report the vocabulary's gaps as the field's shape. The run stops and names
 * the concepts to add rather than shipping a quieter issue.
 */
const MIN_CONCEPT_COVERAGE = 0.6;

export class CoverageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoverageError';
  }
}

interface LeafRow {
  leaf: string;
  leaf_label: string;
  branch: string | null;
  branch_label: string | null;
  channels: number;
  videos: number;
}

/**
 * Ask the graph which subjects this run's channels covered.
 *
 * One query, walking MENTIONS to the concept and BROADER to its parent, so the
 * level a count belongs to comes from the graph rather than from this file.
 */
async function leafCoverage(runId: string): Promise<LeafRow[]> {
  const rows = await getPrismaClient().$queryRaw<
    Array<{
      leaf: string;
      leaf_label: string;
      branch: string | null;
      branch_label: string | null;
      channels: bigint;
      videos: bigint;
    }>
  >`
    SELECT c.title                                        AS leaf,
           c.properties->>'label'                         AS leaf_label,
           p.title                                        AS branch,
           p.properties->>'label'                         AS branch_label,
           count(DISTINCT v.properties->>'channelId')     AS channels,
           count(DISTINCT v.title)                        AS videos
      FROM ontology.edges m
      JOIN ontology.nodes v ON v.id = m.source_id AND v.type = 'editorial_video'
      JOIN ontology.nodes c ON c.id = m.target_id AND c.type = 'editorial_concept'
      LEFT JOIN ontology.edges b
             ON b.source_id = c.id AND b.relation = 'BROADER'
                AND b.user_id = ${EDITORIAL_OWNER}::uuid
      LEFT JOIN ontology.nodes p ON p.id = b.target_id
     WHERE m.user_id = ${EDITORIAL_OWNER}::uuid
       AND m.relation = 'MENTIONS'
       AND v.properties->>'runId' = ${runId}
     GROUP BY 1, 2, 3, 4
     ORDER BY channels DESC
  `;
  return rows.map((r) => ({
    leaf: r.leaf,
    leaf_label: r.leaf_label,
    branch: r.branch,
    branch_label: r.branch_label,
    channels: Number(r.channels),
    videos: Number(r.videos),
  }));
}

export const s5Cross: Stage = {
  id: 'S5_cross',
  what: 'count independent channels per concept, on the graph',
  kind: 'machine',

  async run(input: CorpusRow[], ctx: StageContext): Promise<StageResult> {
    if (input.length === 0) {
      return { survivors: [], drops: [], detail: { concepts: 0 } };
    }

    // 1. The vocabulary, checked and projected into the graph.
    const tax: Taxonomy = loadTaxonomy(ctx.topic.categoryKey);
    const conceptIds = await syncConcepts(tax);

    // 2. This run's corpus, attached to it.
    const bridge = await bridgeCorpus(ctx.runId, input, tax, conceptIds);

    // 3. The gate. A vocabulary that reaches too little of the corpus is not
    //    describing the week, and the run says which concepts are missing
    //    rather than producing a quieter issue.
    const coverage = (input.length - bridge.unmatched) / input.length;
    if (coverage < MIN_CONCEPT_COVERAGE) {
      const examples = input
        .filter((v) => {
          const e = (v.enrichment ?? {}) as { description?: string };
          return !Object.keys(bridge.byConcept).some((k) =>
            (tax.concepts.find((c) => c.key === k)?.aliases ?? []).some((a) =>
              `${v.title} ${e.description ?? ''}`.toLowerCase().includes(a.toLowerCase())
            )
          );
        })
        .slice(0, 5)
        .map((v) => v.title.slice(0, 60));
      throw new CoverageError(
        `the vocabulary names only ${Math.round(coverage * 100)}% of ${input.length} videos ` +
          `(floor ${Math.round(MIN_CONCEPT_COVERAGE * 100)}%). ` +
          `Add concepts to docs/newsletter/ontology/${ctx.topic.categoryKey}.yml before publishing. ` +
          `Unmatched, for example: ${examples.join(' | ')}`
      );
    }

    // 4. Read the week back out of the graph.
    const leaves = await leafCoverage(ctx.runId);
    const distinctChannels = new Set(input.map((v) => v.channelId)).size;
    const backgroundCutoff = Math.max(
      INDEPENDENT_CHANNELS_REQUIRED,
      Math.ceil(distinctChannels * BACKGROUND_SHARE)
    );

    const events = leaves.filter(
      (l) => l.channels >= INDEPENDENT_CHANNELS_REQUIRED && l.channels <= backgroundCutoff
    );
    const background = leaves.filter((l) => l.channels > backgroundCutoff);
    const eventKeys = new Set(events.map((e) => e.leaf));

    // Which leaves did each video name? One pass over the graph rather than a
    // query per video.
    const mentions = await getPrismaClient().$queryRaw<Array<{ vid: string; leaf: string }>>`
      SELECT v.title AS vid, c.title AS leaf
        FROM ontology.edges m
        JOIN ontology.nodes v ON v.id = m.source_id AND v.type = 'editorial_video'
        JOIN ontology.nodes c ON c.id = m.target_id AND c.type = 'editorial_concept'
       WHERE m.user_id = ${EDITORIAL_OWNER}::uuid
         AND m.relation = 'MENTIONS'
         AND v.properties->>'runId' = ${ctx.runId}
    `;
    const byVideo = new Map<string, string[]>();
    for (const m of mentions) {
      byVideo.set(m.vid, [...(byVideo.get(m.vid) ?? []), m.leaf]);
    }
    const leafByKey = new Map(leaves.map((l) => [l.leaf, l]));

    const survivors = input.map((v) => {
      const named = byVideo.get(v.videoId) ?? [];
      const corroborated = named
        .filter((k) => eventKeys.has(k))
        .map((k) => {
          const l = leafByKey.get(k);
          return { term: k, label: l?.leaf_label ?? k, channels: l?.channels ?? 0 };
        })
        .sort((a, b) => b.channels - a.channels);

      return {
        videoId: v.videoId,
        corroboration: {
          concepts: named,
          corroborated,
          background: named.filter((k) => !eventKeys.has(k)),
          strongest: corroborated[0]?.term ?? null,
          independentChannels: corroborated[0]?.channels ?? 0,
          source: 'ontology',
        },
      };
    });

    log.info('S5 complete', {
      coverage: Math.round(coverage * 100),
      events: events.length,
      background: background.length,
    });

    return {
      survivors,
      drops: [],
      detail: {
        rule: `a concept needs ${INDEPENDENT_CHANNELS_REQUIRED} independent channels to be written as fact`,
        vocabulary: `docs/newsletter/ontology/${ctx.topic.categoryKey}.yml v${tax.version}`,
        concepts: conceptIds.size,
        mentionEdges: bridge.mentionEdges,
        coveragePct: Math.round(coverage * 100),
        unmatchedVideos: bridge.unmatched,
        backgroundCutoff,
        background: background.map((b) => ({ key: b.leaf, channels: b.channels })),
        events: events.map((e) => ({
          key: e.leaf,
          label: e.leaf_label,
          branch: e.branch_label,
          channels: e.channels,
          videos: e.videos,
        })),
      },
    };
  },
};
