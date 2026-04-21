/**
 * Mandala Embedding Search
 *
 * Tier 1 of the hybrid mandala generation flow:
 *   1. Embed user goal with Qwen3-Embedding-8B (4096d) via Mac Mini Ollama
 *   2. pgvector cosine similarity search against mandala_embeddings (18,009 rows)
 *   3. Return Top N similar templates with aggregated sub_goals
 *
 * Also used as Tier 3 fallback: similar templates become few-shot examples for OpenRouter LLM.
 *
 * Related: docs/research/mandala-model-eval-v14.md
 */

import { Prisma } from '@prisma/client';
import { config } from '../../config';
import { getPrismaClient } from '../database/client';
import { logger } from '../../utils/logger';

// ─── Types ───

export interface MandalaSearchResult {
  /** Embedding row identifier (NOT user_mandalas.id) */
  mandala_id: string;
  /** Real user_mandalas.id when matched (for clone/preview), null if no template row */
  template_mandala_id: string | null;
  center_goal: string;
  center_label: string | null;
  domain: string | null;
  language: string | null;
  similarity: number;
  sub_goals: string[];
  sub_labels: string[];
  /** depth=1 actions per sub_goal index (0..7 → 8 strings each) */
  sub_actions: Record<number, string[]>;
}

export interface MandalaSearchOptions {
  limit?: number;
  threshold?: number;
  language?: string;
}

// ─── Constants ───

const DEFAULT_LIMIT = 5;
// CP358: Lowered from 0.5 to 0.3 after prod cosine sim measurement showed
// "행복한 가족" → top match was 0.4166 against 1001 KO templates. dev's
// data distribution clustered tighter; prod's broader template set produces
// lower max sim values, so 0.5 always returned []. Minimum results below
// also guarantees we never return an empty list when ANY data exists.
const DEFAULT_THRESHOLD = 0.3;
/** When threshold filter would return 0 rows, fall back to top-N regardless. */
const MIN_RESULTS_GUARANTEE = 3;
const MAX_LIMIT = 20;
const EMBED_TIMEOUT_MS = 30_000;

/** UUID of the system-templates@insighta.one user that owns all explore templates */
const SYSTEM_TEMPLATES_USER_ID = '00000000-0000-0000-0000-000000000001';

// ─── Embedding (provider-switched) ───

/**
 * Embed a goal text.
 *
 * Routes by `config.mandalaEmbed.provider`:
 *   - 'ollama' (default): legacy Mac-mini Ollama path at MANDALA_GEN_URL
 *     with qwen3-embedding:8b. Kept bit-identical so flag-off rollback
 *     returns to pre-Phase-1 behaviour.
 *   - 'openrouter' (Phase 1, 2026-04-22): OpenRouter-hosted same-family
 *     Qwen3-Embedding-8B. Eliminates the mac-mini dependency on the
 *     wizard critical path. Dim remains 4096 so existing vector(4096)
 *     table and 18k rows are reusable.
 *
 * Both return a same-dim vector matching mandala_embeddings.
 */
export async function embedGoalForMandala(goalText: string): Promise<number[]> {
  const provider = config.mandalaEmbed.provider;
  if (provider === 'openrouter') {
    return embedViaOpenRouter(goalText);
  }
  return embedViaOllama(goalText);
}

async function embedViaOllama(goalText: string): Promise<number[]> {
  const url = config.mandalaGen.url;
  const model = config.mandalaGen.embedModel;
  const expectedDim = config.mandalaGen.embedDimension;

  if (!url) {
    throw new MandalaSearchError('MANDALA_GEN_URL not configured', 'SERVICE_UNAVAILABLE');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

  try {
    const response = await fetch(`${url}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: goalText }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const body = await response.text();
      throw new MandalaSearchError(
        `Ollama embed API error ${response.status}: ${body}`,
        'SERVICE_UNAVAILABLE'
      );
    }

    const data = (await response.json()) as { embeddings?: number[][] };
    const vector = data.embeddings?.[0];

    if (!vector || vector.length === 0) {
      throw new MandalaSearchError('Ollama returned empty embedding', 'EMBED_FAILED');
    }

    if (vector.length !== expectedDim) {
      throw new MandalaSearchError(
        `Embedding dimension mismatch: got ${vector.length}, expected ${expectedDim}`,
        'DIMENSION_MISMATCH'
      );
    }

    return vector;
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof MandalaSearchError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new MandalaSearchError('Embedding request timed out', 'TIMEOUT');
    }
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
      throw new MandalaSearchError(
        `Cannot reach embedding server at ${url}`,
        'SERVICE_UNAVAILABLE'
      );
    }
    throw new MandalaSearchError(message, 'EMBED_FAILED');
  }
}

/**
 * OpenRouter embedding client (Phase 1).
 *
 * Uses the OpenAI-compatible /embeddings endpoint on OpenRouter. Provider
 * routing and rate-limits are OpenRouter's responsibility; this client only
 * translates the standard schema to our internal vector shape + enforces
 * the same dim check as the Ollama path.
 *
 * On auth/network/timeout failure, throws MandalaSearchError with a code
 * aligned with the Ollama path so upstream handlers don't need to special
 * case.
 */
async function embedViaOpenRouter(goalText: string): Promise<number[]> {
  const baseUrl = config.mandalaEmbed.openRouterBaseUrl;
  const model = config.mandalaEmbed.openRouterModel;
  const expectedDim = config.mandalaEmbed.openRouterDimension;
  const apiKey = config.openrouter.apiKey;

  if (!apiKey) {
    throw new MandalaSearchError('OPENROUTER_API_KEY not configured', 'SERVICE_UNAVAILABLE');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), EMBED_TIMEOUT_MS);

  try {
    const response = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: goalText, encoding_format: 'float' }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      const body = await response.text();
      const code =
        response.status === 401
          ? 'SERVICE_UNAVAILABLE'
          : response.status === 429
            ? 'RATE_LIMITED'
            : 'SERVICE_UNAVAILABLE';
      throw new MandalaSearchError(
        `OpenRouter embed API error ${response.status}: ${body.slice(0, 200)}`,
        code
      );
    }

    const data = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vector = data.data?.[0]?.embedding;

    if (!vector || vector.length === 0) {
      throw new MandalaSearchError('OpenRouter returned empty embedding', 'EMBED_FAILED');
    }

    if (vector.length !== expectedDim) {
      throw new MandalaSearchError(
        `OpenRouter embedding dimension mismatch: got ${vector.length}, expected ${expectedDim}`,
        'DIMENSION_MISMATCH'
      );
    }

    return vector;
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof MandalaSearchError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new MandalaSearchError('OpenRouter embed request timed out', 'TIMEOUT');
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new MandalaSearchError(`OpenRouter embed failed: ${message}`, 'EMBED_FAILED');
  }
}

// ─── Vector Search ───

/**
 * Search mandala_embeddings for the Top N most similar templates to a goal.
 *
 * Strategy:
 *   1. Query level=0 rows (center goals) for Top N mandala_ids by cosine similarity
 *   2. Fetch level=1 rows (sub_goals) for those mandala_ids
 *   3. Combine into MandalaSearchResult[]
 */
export async function searchMandalasByGoal(
  goalText: string,
  options: MandalaSearchOptions = {}
): Promise<MandalaSearchResult[]> {
  const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;

  const queryVector = await embedGoalForMandala(goalText);
  const embeddingStr = `[${queryVector.join(',')}]`;

  logger.info(`Mandala search: goal="${goalText}" limit=${limit} threshold=${threshold}`);

  const prisma = getPrismaClient();

  // Step 1: Top N unique mandalas by cosine similarity.
  //
  // Row convention in mandala_embeddings:
  //   level=1, sub_goal_index IS NULL  → center-goal embedding (1 per template)
  //   level=1, sub_goal_index IN 0..7  → sub_goal embedding (8 per user mandala)
  //
  // Template search uses the center-goal variant. ROW_NUMBER dedup is a
  // safety belt in case a mandala has multiple center rows (seed bugs,
  // concurrent writers).
  const conditions: Prisma.Sql[] = [
    Prisma.sql`level = 1`,
    Prisma.sql`sub_goal_index IS NULL`,
    Prisma.sql`embedding IS NOT NULL`,
    Prisma.sql`1 - (embedding <=> ${embeddingStr}::vector) >= ${threshold}`,
  ];
  if (options.language) {
    conditions.push(Prisma.sql`language = ${options.language}`);
  }
  const where = Prisma.join(conditions, ' AND ');

  type TopRow = {
    mandala_id: string;
    center_goal: string;
    center_label: string | null;
    domain: string | null;
    language: string | null;
    similarity: number;
  };

  let topRows = await prisma.$queryRaw<TopRow[]>`
    WITH ranked AS (
      SELECT
        mandala_id::text AS mandala_id,
        center_goal,
        center_label,
        domain,
        language,
        1 - (embedding <=> ${embeddingStr}::vector) AS similarity,
        ROW_NUMBER() OVER (
          PARTITION BY mandala_id
          ORDER BY embedding <=> ${embeddingStr}::vector
        ) AS rn
      FROM mandala_embeddings
      WHERE ${where}
    )
    SELECT mandala_id, center_goal, center_label, domain, language, similarity
    FROM ranked
    WHERE rn = 1
    ORDER BY similarity DESC
    LIMIT ${limit}
  `;

  // CP358 min-results guarantee: if the threshold filter returned fewer than
  // MIN_RESULTS_GUARANTEE rows, retry WITHOUT the threshold filter so the
  // user always sees the closest matches. UX rule: showing 3 imperfect
  // matches > showing nothing.
  if (topRows.length < MIN_RESULTS_GUARANTEE) {
    const fallbackConditions: Prisma.Sql[] = [
      Prisma.sql`level = 1`,
      Prisma.sql`sub_goal_index IS NULL`,
      Prisma.sql`embedding IS NOT NULL`,
    ];
    if (options.language) {
      fallbackConditions.push(Prisma.sql`language = ${options.language}`);
    }
    const fallbackWhere = Prisma.join(fallbackConditions, ' AND ');
    logger.info(
      `Mandala search fallback: threshold ${threshold} produced ${topRows.length} rows for "${goalText}", retrying without threshold`
    );
    topRows = await prisma.$queryRaw<TopRow[]>`
      WITH ranked AS (
        SELECT
          mandala_id::text AS mandala_id,
          center_goal,
          center_label,
          domain,
          language,
          1 - (embedding <=> ${embeddingStr}::vector) AS similarity,
          ROW_NUMBER() OVER (
            PARTITION BY mandala_id
            ORDER BY embedding <=> ${embeddingStr}::vector
          ) AS rn
        FROM mandala_embeddings
        WHERE ${fallbackWhere}
      )
      SELECT mandala_id, center_goal, center_label, domain, language, similarity
      FROM ranked
      WHERE rn = 1
      ORDER BY similarity DESC
      LIMIT ${limit}
    `;
  }

  if (topRows.length === 0) {
    return [];
  }

  // Step 2: Resolve embedding.mandala_id → user_mandalas row.
  // Primary: direct UUID match. Fallback: center_goal title match
  // against system-template rows (covers legacy embeddings whose
  // mandala_id is not a real user_mandalas.id).
  //
  // user_mandalas is the SSOT for domain + language — never read those
  // from mandala_embeddings (the seed may drop or drift them).
  const embedMandalaIds = topRows.map((r) => r.mandala_id);
  const centerGoals = topRows.map((r) => r.center_goal);

  interface TemplateMetaRow {
    id: string;
    title: string;
    domain: string | null;
    language: string | null;
  }
  const templateRows = await prisma.$queryRaw<TemplateMetaRow[]>`
    SELECT id::text AS id, title, domain, language
    FROM user_mandalas
    WHERE id::text = ANY(${embedMandalaIds}::text[])
       OR (
         user_id = ${SYSTEM_TEMPLATES_USER_ID}::uuid
         AND title = ANY(${centerGoals}::text[])
       )
  `;
  const idToTemplate = new Map<string, TemplateMetaRow>();
  const titleToTemplate = new Map<string, TemplateMetaRow>();
  for (const t of templateRows) {
    idToTemplate.set(t.id, t);
    titleToTemplate.set(t.title, t);
  }

  // Step 3: Fetch depth=0 (sub_goals + sub_labels + center_label) and
  // depth=1 (64 actions) for all resolved templates in one query.
  // user_mandala_levels is the authoritative source:
  //   depth=0 row:
  //     center_goal    — full center text
  //     center_label   — short center label (e.g. "미국주식 1억")
  //     subjects[0..7] — 8 long sub_goal texts
  //     subject_labels[0..7] — 8 short labels (e.g. "시장 기초")
  //   depth=1 rows (position 0..7):
  //     subjects[0..7] — 8 depth=1 actions per sub_goal (64 total)
  const templateIds = Array.from(new Set(templateRows.map((t) => t.id)));
  let levelRows: Array<{
    mandala_id: string;
    depth: number;
    position: number;
    subjects: string[];
    subject_labels: string[] | null;
    center_label: string | null;
  }> = [];
  if (templateIds.length > 0) {
    levelRows = await prisma.$queryRaw<
      Array<{
        mandala_id: string;
        depth: number;
        position: number;
        subjects: string[];
        subject_labels: string[] | null;
        center_label: string | null;
      }>
    >`
      SELECT
        mandala_id::text AS mandala_id,
        depth,
        position,
        subjects,
        subject_labels,
        center_label
      FROM user_mandala_levels
      WHERE mandala_id::text = ANY(${templateIds}::text[])
        AND depth IN (0, 1)
      ORDER BY mandala_id, depth, position
    `;
  }

  // Group levels:
  //   depth=0, position=0 → sub_goals (long) + sub_labels (short) + centerLabel
  //   depth=1, position=0..7 → sub_actions[position] = subjects[0..7] (64 total)
  const subGoalsByTemplate = new Map<string, string[]>();
  const subLabelsByTemplate = new Map<string, string[]>();
  const centerLabelByTemplate = new Map<string, string | null>();
  const actionsByTemplate = new Map<string, Record<number, string[]>>();
  for (const row of levelRows) {
    if (row.depth === 0 && row.position === 0) {
      subGoalsByTemplate.set(row.mandala_id, row.subjects ?? []);
      subLabelsByTemplate.set(row.mandala_id, row.subject_labels ?? []);
      centerLabelByTemplate.set(row.mandala_id, row.center_label);
      continue;
    }
    if (row.depth === 1) {
      const map = actionsByTemplate.get(row.mandala_id) ?? {};
      map[row.position] = row.subjects ?? [];
      actionsByTemplate.set(row.mandala_id, map);
    }
  }

  // Step 4: Combine. sub_goals (long text) and sub_labels (short labels)
  // are distinct fields from user_mandala_levels. domain, language and
  // center_label are taken from user_mandalas / user_mandala_levels
  // (SSOT), not from the embedding row.
  return topRows.map((row) => {
    const template =
      idToTemplate.get(row.mandala_id) ?? titleToTemplate.get(row.center_goal) ?? null;
    const templateMandalaId = template?.id ?? null;
    const subGoals = templateMandalaId ? (subGoalsByTemplate.get(templateMandalaId) ?? []) : [];
    const subLabels = templateMandalaId ? (subLabelsByTemplate.get(templateMandalaId) ?? []) : [];
    const subActions = templateMandalaId ? (actionsByTemplate.get(templateMandalaId) ?? {}) : {};
    const centerLabel = templateMandalaId
      ? (centerLabelByTemplate.get(templateMandalaId) ?? row.center_label)
      : row.center_label;
    return {
      mandala_id: row.mandala_id,
      template_mandala_id: templateMandalaId,
      center_goal: row.center_goal,
      center_label: centerLabel,
      domain: template?.domain ?? row.domain,
      language: template?.language ?? row.language,
      similarity: Number(row.similarity),
      sub_goals: subGoals,
      sub_labels: subLabels,
      sub_actions: subActions,
    };
  });
}

// ─── Few-shot Text Extraction (for Tier 3 LLM fallback) ───

/**
 * Format mandala search results as few-shot examples for LLM prompting.
 * Returns an array of formatted text blocks.
 */
export function formatMandalasForFewShot(results: MandalaSearchResult[]): string[] {
  return results.map((r, idx) => {
    const subGoalsList = r.sub_goals.length > 0 ? r.sub_goals.join(', ') : '(none)';
    return `[Example ${idx + 1}]\nCenter goal: ${r.center_goal}\nDomain: ${r.domain ?? 'general'}\nLanguage: ${r.language ?? 'ko'}\nSub-goals: ${subGoalsList}`;
  });
}

// ─── Error class ───

export type MandalaSearchErrorCode =
  | 'SERVICE_UNAVAILABLE'
  | 'EMBED_FAILED'
  | 'DIMENSION_MISMATCH'
  | 'RATE_LIMITED'
  | 'TIMEOUT';

export class MandalaSearchError extends Error {
  constructor(
    message: string,
    public readonly code: MandalaSearchErrorCode
  ) {
    super(message);
    this.name = 'MandalaSearchError';
  }
}
