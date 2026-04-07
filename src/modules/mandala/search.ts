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
const DEFAULT_THRESHOLD = 0.3;
const MAX_LIMIT = 20;
const EMBED_TIMEOUT_MS = 30_000;

/** UUID of the system-templates@insighta.one user that owns all explore templates */
const SYSTEM_TEMPLATES_USER_ID = '00000000-0000-0000-0000-000000000001';

// ─── Embedding (Ollama /api/embed) ───

/**
 * Embed a goal text using qwen3-embedding:8b on Mac Mini Ollama.
 * Returns 4096-dimensional vector matching mandala_embeddings table.
 */
export async function embedGoalForMandala(goalText: string): Promise<number[]> {
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

  // Step 1: Top N mandala_ids from level=1 rows (center goals)
  // Schema: level 1 = center, level 2 = sub_goal (per 20260403_mandala_embeddings.sql)
  const conditions: Prisma.Sql[] = [
    Prisma.sql`level = 1`,
    Prisma.sql`embedding IS NOT NULL`,
    Prisma.sql`1 - (embedding <=> ${embeddingStr}::vector) >= ${threshold}`,
  ];
  if (options.language) {
    conditions.push(Prisma.sql`language = ${options.language}`);
  }
  const where = Prisma.join(conditions, ' AND ');

  const topRows = await prisma.$queryRaw<
    Array<{
      mandala_id: string;
      center_goal: string;
      center_label: string | null;
      domain: string | null;
      language: string | null;
      similarity: number;
    }>
  >`
    SELECT
      mandala_id::text AS mandala_id,
      center_goal,
      center_label,
      domain,
      language,
      1 - (embedding <=> ${embeddingStr}::vector) AS similarity
    FROM mandala_embeddings
    WHERE ${where}
    ORDER BY embedding <=> ${embeddingStr}::vector
    LIMIT ${limit}
  `;

  if (topRows.length === 0) {
    return [];
  }

  // Step 2: Fetch sub_goals + sub_labels (level=2) for the matched mandala_ids
  const mandalaIds = topRows.map((r) => r.mandala_id);
  const subGoalRows = await prisma.$queryRaw<
    Array<{
      mandala_id: string;
      sub_goal_index: number | null;
      sub_goal: string | null;
      sub_label: string | null;
    }>
  >`
    SELECT mandala_id::text AS mandala_id, sub_goal_index, sub_goal, sub_label
    FROM mandala_embeddings
    WHERE mandala_id::text = ANY(${mandalaIds}::text[])
      AND level = 2
    ORDER BY mandala_id, sub_goal_index
  `;

  // Group sub_goals + sub_labels by mandala_id
  const subGoalsByMandala = new Map<string, string[]>();
  const subLabelsByMandala = new Map<string, string[]>();
  for (const row of subGoalRows) {
    if (row.sub_goal) {
      const arr = subGoalsByMandala.get(row.mandala_id) ?? [];
      arr.push(row.sub_goal);
      subGoalsByMandala.set(row.mandala_id, arr);
    }
    if (row.sub_label) {
      const arr = subLabelsByMandala.get(row.mandala_id) ?? [];
      arr.push(row.sub_label);
      subLabelsByMandala.set(row.mandala_id, arr);
    }
  }

  // Step 3: Map embedding center_goal → real user_mandalas.id (system templates)
  // and fetch depth=1 levels (64 actions per mandala)
  const centerGoals = topRows.map((r) => r.center_goal);
  const templateRows = await prisma.$queryRaw<Array<{ id: string; title: string }>>`
    SELECT id::text AS id, title
    FROM user_mandalas
    WHERE user_id = ${SYSTEM_TEMPLATES_USER_ID}::uuid
      AND title = ANY(${centerGoals}::text[])
  `;
  const titleToTemplateId = new Map<string, string>();
  for (const t of templateRows) {
    titleToTemplateId.set(t.title, t.id);
  }

  // Step 4: Fetch depth=1 levels for matched templates → 64 actions per mandala
  const templateIds = templateRows.map((t) => t.id);
  let levelRows: Array<{
    mandala_id: string;
    position: number;
    subjects: string[];
  }> = [];
  if (templateIds.length > 0) {
    levelRows = await prisma.$queryRaw<
      Array<{ mandala_id: string; position: number; subjects: string[] }>
    >`
      SELECT mandala_id::text AS mandala_id, position, subjects
      FROM user_mandala_levels
      WHERE mandala_id::text = ANY(${templateIds}::text[])
        AND depth = 1
      ORDER BY mandala_id, position
    `;
  }

  // Group depth=1 levels (subjects[8] each) into Record<position, string[]>
  const actionsByMandala = new Map<string, Record<number, string[]>>();
  for (const row of levelRows) {
    const map = actionsByMandala.get(row.mandala_id) ?? {};
    map[row.position] = row.subjects ?? [];
    actionsByMandala.set(row.mandala_id, map);
  }

  // Combine
  return topRows.map((row) => {
    const templateMandalaId = titleToTemplateId.get(row.center_goal) ?? null;
    const subActions = templateMandalaId ? (actionsByMandala.get(templateMandalaId) ?? {}) : {};
    return {
      mandala_id: row.mandala_id,
      template_mandala_id: templateMandalaId,
      center_goal: row.center_goal,
      center_label: row.center_label,
      domain: row.domain,
      language: row.language,
      similarity: Number(row.similarity),
      sub_goals: subGoalsByMandala.get(row.mandala_id) ?? [],
      sub_labels: subLabelsByMandala.get(row.mandala_id) ?? [],
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
