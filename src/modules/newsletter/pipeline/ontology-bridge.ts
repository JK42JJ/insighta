/**
 * The brief's corner of the knowledge graph.
 *
 * Two things happen here, and the order matters.
 *
 * First the curated vocabulary is put into `ontology.nodes` as
 * `editorial_concept` nodes with `BROADER` edges between them. The file is the
 * source of truth; the graph is its projection, rebuilt on every run. A
 * concept is never invented by the machine, and a concept that disappears from
 * the file is deactivated rather than deleted — a past issue cited it, and
 * removing it would remove that issue's grounds.
 *
 * Then this run's corpus is attached: one `editorial_video` node per surviving
 * video, and a `MENTIONS` edge to every concept its title and description name.
 *
 * Why this rather than the graph that already exists: the ontology holds
 * 210,830 nodes and none of them can serve a brief. Its 25,337 `concept` nodes
 * belong to one reader and describe camping, interior work and car trims. So
 * the brief gets its own vocabulary in the same tables under the `shared`
 * domain, which the schema's domain check already allows, and a database
 * trigger refuses any edge that would cross into a reader's graph.
 *
 * Why a graph at all, when a list of aliases already matched text: because
 * counting needs a level. The first version of S5 counted `agent` and found it
 * on 144 of 274 channels, which said nothing — every video scored the same and
 * the ranking signal died. With `BROADER` edges the count happens at the leaf
 * and the summary happens at the branch.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import type { CorpusRow } from './corpus';

const log = logger.child({ module: 'newsletter/ontology-bridge' });

/**
 * Who owns editorial nodes.
 *
 * `ontology.nodes.user_id` is NOT NULL and there is no editorial user, so the
 * all-zeros-plus-two constant stands in. The graph already uses
 * `...0001` the same way, so this follows a convention rather than inventing
 * one. It is not a login and nothing authenticates as it.
 */
export const EDITORIAL_OWNER = '00000000-0000-0000-0000-000000000002';

export interface ConceptDef {
  key: string;
  label: string;
  broader?: string;
  aliases: string[];
  active?: boolean;
}

export interface Taxonomy {
  version: number;
  category: string;
  concepts: ConceptDef[];
}

export class TaxonomyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaxonomyError';
  }
}

/**
 * Read and check the vocabulary.
 *
 * Validated on load rather than on use: a broken taxonomy should stop a run at
 * the start, not produce a quietly emptier issue at the end.
 */
export function loadTaxonomy(categoryKey: string, dir = 'docs/newsletter/ontology'): Taxonomy {
  const path = join(dir, `${categoryKey}.yml`);
  const doc = parseYaml(readFileSync(path, 'utf8')) as Taxonomy;

  if (!Array.isArray(doc?.concepts) || doc.concepts.length === 0) {
    throw new TaxonomyError(`${path}: no concepts`);
  }
  const keys = new Set(doc.concepts.map((c) => c.key));
  for (const c of doc.concepts) {
    if (!c.key || !c.label) throw new TaxonomyError(`${path}: a concept needs a key and a label`);
    if (!Array.isArray(c.aliases) || c.aliases.length === 0) {
      throw new TaxonomyError(`${path}: ${c.key} has no aliases — nothing would ever match it`);
    }
    if (c.broader) {
      if (!keys.has(c.broader)) {
        throw new TaxonomyError(`${path}: ${c.key} is under ${c.broader}, which does not exist`);
      }
      const parent = doc.concepts.find((p) => p.key === c.broader);
      if (parent?.broader) {
        throw new TaxonomyError(
          `${path}: ${c.key} sits three levels deep (${c.broader} is itself under ${parent.broader}).` +
            ' One level of nesting only — a deeper tree does not get maintained.'
        );
      }
    }
  }
  return doc;
}

interface NodeRow {
  id: string;
  title: string;
}

/** Put the vocabulary into the graph, and return key -> node id. */
export async function syncConcepts(tax: Taxonomy): Promise<Map<string, string>> {
  const prisma = getPrismaClient();
  const ids = new Map<string, string>();

  for (const c of tax.concepts) {
    const props = {
      label: c.label,
      aliases: c.aliases,
      broader: c.broader ?? null,
      category: tax.category,
      taxonomyVersion: tax.version,
      active: c.active !== false,
    };
    const rows = await prisma.$queryRaw<NodeRow[]>`
      INSERT INTO ontology.nodes (user_id, type, title, properties, domain)
      VALUES (${EDITORIAL_OWNER}::uuid, 'editorial_concept', ${c.key},
              ${JSON.stringify(props)}::jsonb, 'shared')
      ON CONFLICT (user_id, type, title)
        WHERE type IN ('editorial_concept','editorial_video','editorial_issue')
      DO UPDATE SET properties = EXCLUDED.properties, updated_at = now()
      RETURNING id, title
    `;
    const id = rows[0]?.id;
    if (id) ids.set(c.key, id);
  }

  // BROADER edges. Rebuilt from the file every run, so moving a concept in the
  // file moves it in the graph rather than leaving both parents attached.
  await prisma.$executeRaw`
    DELETE FROM ontology.edges
     WHERE user_id = ${EDITORIAL_OWNER}::uuid AND relation = 'BROADER'
  `;
  let edges = 0;
  for (const c of tax.concepts) {
    if (!c.broader) continue;
    const child = ids.get(c.key);
    const parent = ids.get(c.broader);
    if (!child || !parent) continue;
    await prisma.$executeRaw`
      INSERT INTO ontology.edges (user_id, source_id, target_id, relation, weight, properties, domain)
      VALUES (${EDITORIAL_OWNER}::uuid, ${child}::uuid, ${parent}::uuid, 'BROADER', 1, '{}'::jsonb, 'shared')
    `;
    edges += 1;
  }

  log.info('taxonomy synced to graph', { concepts: ids.size, broaderEdges: edges });
  return ids;
}

/** Which concepts does this text name? Leaf keys, not their parents. */
export function conceptsIn(text: string, tax: Taxonomy): string[] {
  const t = text.toLowerCase();
  return tax.concepts
    .filter((c) => c.active !== false && c.aliases.some((a) => t.includes(a.toLowerCase())))
    .map((c) => c.key);
}

export interface BridgeResult {
  videoNodes: number;
  mentionEdges: number;
  /** Videos that named no concept at all. The coverage gate reads this. */
  unmatched: number;
  byConcept: Record<string, number>;
}

/**
 * Attach this run's corpus to the vocabulary.
 *
 * A video that names no concept is not an error — it is a video about
 * something the vocabulary has not learned yet, and the count of those is the
 * signal that the file needs an entry. S5's gate reads it.
 */
export async function bridgeCorpus(
  runId: string,
  rows: CorpusRow[],
  tax: Taxonomy,
  conceptIds: Map<string, string>
): Promise<BridgeResult> {
  const prisma = getPrismaClient();
  const out: BridgeResult = { videoNodes: 0, mentionEdges: 0, unmatched: 0, byConcept: {} };

  for (const v of rows) {
    const e = (v.enrichment ?? {}) as { description?: string; tags?: string[] };
    const haystack = [v.title, e.description ?? '', (e.tags ?? []).join(' ')].join(' ');
    const keys = conceptsIn(haystack, tax);
    if (keys.length === 0) out.unmatched += 1;

    const nodeRows = await prisma.$queryRaw<NodeRow[]>`
      INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref, domain)
      VALUES (${EDITORIAL_OWNER}::uuid, 'editorial_video', ${v.videoId},
              ${JSON.stringify({
                videoTitle: v.title,
                channelId: v.channelId,
                channelTitle: v.channelTitle,
                publishedAt: v.publishedAt.toISOString(),
                source: v.source,
                runId,
              })}::jsonb,
              ${JSON.stringify({ table: 'newsletter_corpus', id: `${runId}:${v.videoId}` })}::jsonb,
              'shared')
      ON CONFLICT (user_id, type, title)
        WHERE type IN ('editorial_concept','editorial_video','editorial_issue')
      DO UPDATE SET properties = EXCLUDED.properties, updated_at = now()
      RETURNING id, title
    `;
    const videoNodeId = nodeRows[0]?.id;
    if (!videoNodeId) continue;
    out.videoNodes += 1;

    // Rebuilt per video so a re-run does not accumulate duplicates.
    await prisma.$executeRaw`
      DELETE FROM ontology.edges
       WHERE user_id = ${EDITORIAL_OWNER}::uuid
         AND relation = 'MENTIONS'
         AND source_id = ${videoNodeId}::uuid
    `;
    for (const key of keys) {
      const conceptId = conceptIds.get(key);
      if (!conceptId) continue;
      await prisma.$executeRaw`
        INSERT INTO ontology.edges (user_id, source_id, target_id, relation, weight, properties, domain)
        VALUES (${EDITORIAL_OWNER}::uuid, ${videoNodeId}::uuid, ${conceptId}::uuid, 'MENTIONS', 1,
                ${JSON.stringify({ runId })}::jsonb, 'shared')
      `;
      out.mentionEdges += 1;
      out.byConcept[key] = (out.byConcept[key] ?? 0) + 1;
    }
  }

  log.info('corpus bridged to graph', {
    runId,
    videoNodes: out.videoNodes,
    mentionEdges: out.mentionEdges,
    unmatched: out.unmatched,
  });
  return out;
}
