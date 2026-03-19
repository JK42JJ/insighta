import { getPrismaClient } from '../database/client';
import { getCaptionExtractor } from '../caption/extractor';
import { createGenerationProvider } from '../llm';
import { embedNode } from './embedding';
import { logger } from '../../utils/logger';

// ============================================================================
// Resource Node Enrichment — YouTube transcript → LLM summary → re-embed
// ============================================================================

const MAX_TRANSCRIPT_CHARS = 10000;
const AI_SUMMARY_PREFIX = '🤖 AI Summary:\n';
const AI_SUMMARY_PREFIX_KO = '🤖 AI 요약:\n';

// Chunked summarization constants (qwen3.5:9b limitation: >500 chars → empty response)
const CHUNK_THRESHOLD = 500;
const MAX_CHUNK_SIZE = 300;
const MAX_MERGE_INPUT = 400;

interface EnrichResult {
  nodeId: string;
  summary: string;
  tags: string[];
  embedded: boolean;
}

interface BatchEnrichResult {
  total: number;
  enriched: number;
  skipped: number;
  errors: { nodeId: string; error: string }[];
}

function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === 'youtu.be') {
      return parsed.pathname.slice(1) || null;
    }
    if (
      parsed.hostname === 'www.youtube.com' ||
      parsed.hostname === 'youtube.com' ||
      parsed.hostname === 'm.youtube.com'
    ) {
      return parsed.searchParams.get('v') || null;
    }
    return null;
  } catch {
    return null;
  }
}

interface SummaryResponse {
  summary: string;
  tags: string[];
}

function parseSummaryResponse(raw: string): SummaryResponse {
  // Try to extract JSON from the response (may have markdown fences)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('No JSON found in LLM response');
  }
  const parsed = JSON.parse(jsonMatch[0]);
  if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.tags)) {
    throw new Error('Invalid summary response structure');
  }
  return {
    summary: parsed.summary,
    tags: parsed.tags.map(String),
  };
}

// ============================================================================
// Chunked Summarization — split long transcripts for small LLMs
// ============================================================================

/**
 * Split text into paragraphs by double newlines or consecutive newlines.
 */
function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Split a single long paragraph by sentence boundaries (. ! ?).
 */
function splitBySentences(text: string, maxSize: number): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (current.length + trimmed.length + 1 > maxSize && current.length > 0) {
      chunks.push(current.trim());
      current = trimmed;
    } else {
      current += (current ? ' ' : '') + trimmed;
    }
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

/**
 * Pack paragraphs into chunks of maxSize characters, preserving paragraph boundaries.
 * If a single paragraph exceeds maxSize, split it by sentence boundaries.
 */
function packChunks(paragraphs: string[], maxSize: number): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (para.length > maxSize) {
      // Flush current buffer first
      if (current.trim()) {
        chunks.push(current.trim());
        current = '';
      }
      // Split oversized paragraph by sentences
      chunks.push(...splitBySentences(para, maxSize));
      continue;
    }

    if (current.length + para.length + 1 > maxSize && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? '\n' : '') + para;
    }
  }
  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}

function buildChunkSummaryPrompt(chunk: string): string {
  return `Summarize in 1 sentence. Do NOT start with "This video" or "The video":\n${chunk}`;
}

function buildMergePrompt(partials: string[], title: string): string {
  const list = partials.map((p) => `- ${p}`).join('\n');
  return `Video: ${title}\nSummaries:\n${list}\nCombine into JSON: {"summary":"2-3 sentence summary","tags":["keyword1","keyword2"]}\nRespond in English. Do NOT start summary with "This video" or "The video".`;
}

const MAX_REDUCE_DEPTH = 5;

/**
 * Hierarchically reduce partial summaries if they exceed merge budget.
 * Groups partials into batches that fit within MAX_MERGE_INPUT,
 * summarizes each batch, then recurses if needed (up to MAX_REDUCE_DEPTH).
 */
async function reducePartials(
  partials: string[],
  generate: (prompt: string) => Promise<string>,
  depth: number = 0
): Promise<string[]> {
  const totalSize = partials.reduce((sum, p) => sum + p.length + 3, 0);
  if (totalSize <= MAX_MERGE_INPUT) {
    return partials;
  }

  // Safety: if max depth reached, force-truncate to fit
  if (depth >= MAX_REDUCE_DEPTH) {
    logger.warn('reducePartials max depth reached, truncating', { depth, partials: partials.length });
    const truncated: string[] = [];
    let budget = MAX_MERGE_INPUT;
    for (const p of partials) {
      const entry = p.slice(0, 80);
      if (budget - entry.length - 3 < 0) break;
      truncated.push(entry);
      budget -= entry.length + 3;
    }
    return truncated.length > 0 ? truncated : [partials[0]!.slice(0, 100)];
  }

  // Group partials into batches of 3-5 items each (not by size alone)
  const BATCH_SIZE = 4;
  const batches: string[][] = [];
  for (let i = 0; i < partials.length; i += BATCH_SIZE) {
    batches.push(partials.slice(i, i + BATCH_SIZE));
  }

  // Summarize each batch into 1 sentence
  const reduced: string[] = [];
  for (const group of batches) {
    if (group.length === 1) {
      // Single item: shorten it via LLM
      const prompt = `Shorten to 1 sentence:\n${group[0]}`;
      const result = await generate(prompt);
      reduced.push(result.trim().slice(0, 120));
      continue;
    }
    const prompt = `Combine into 1 sentence:\n${group.map((g) => `- ${g}`).join('\n')}`;
    const result = await generate(prompt);
    reduced.push(result.trim().slice(0, 120));
  }

  // Recurse if still too large
  const reducedSize = reduced.reduce((sum, p) => sum + p.length + 3, 0);
  if (reducedSize > MAX_MERGE_INPUT && reduced.length > 1) {
    return reducePartials(reduced, generate, depth + 1);
  }

  return reduced;
}

/**
 * Chunked summarization strategy for long transcripts.
 * Splits transcript → chunk summaries (plain text) → merge (JSON).
 */
async function chunkedSummarize(
  title: string,
  transcript: string,
  generate: (prompt: string, options?: { format?: 'json' | 'text'; temperature?: number }) => Promise<string>
): Promise<SummaryResponse> {
  const truncated = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
  const paragraphs = splitIntoParagraphs(truncated);
  const chunks = packChunks(paragraphs, MAX_CHUNK_SIZE);

  logger.info('Chunked summarization', { chunks: chunks.length, totalChars: truncated.length });

  // Phase 1: Summarize each chunk (plain text, no JSON)
  const partials: string[] = [];
  for (const chunk of chunks) {
    const prompt = buildChunkSummaryPrompt(chunk);
    const result = await generate(prompt, { temperature: 0.3 });
    const trimmed = result.trim();
    if (trimmed) {
      partials.push(trimmed);
    }
  }

  if (partials.length === 0) {
    throw new Error('All chunk summaries returned empty');
  }

  // Phase 2: Reduce partials if too many for merge prompt
  const plainGenerate = (p: string) => generate(p, { temperature: 0.3 });
  const reducedPartials = await reducePartials(partials, plainGenerate);

  // Phase 3: Merge into final JSON response
  const mergePrompt = buildMergePrompt(reducedPartials, title);
  logger.info('Merge prompt size', { chars: mergePrompt.length, partials: reducedPartials.length });

  const mergeResult = await generate(mergePrompt, { format: 'json', temperature: 0.3 });
  return parseSummaryResponse(mergeResult);
}

function buildSummaryPrompt(title: string, transcript: string): string {
  const truncated = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
  return `Given this YouTube video transcript, provide:
1. A concise summary (2-3 sentences) describing what this video is about
2. 5-10 relevant topic keywords/tags

Video title: ${title}
Transcript: ${truncated}

Respond in JSON: {"summary": "...", "tags": ["...", ...]}
Important: Respond in English. Do NOT start summary with "This video" or "The video".`;
}

export async function enrichResourceNode(
  nodeId: string,
  userId: string
): Promise<EnrichResult> {
  const prisma = getPrismaClient();

  // 1. Get resource node
  const nodes = await prisma.$queryRaw<
    { id: string; title: string; properties: Record<string, unknown>; source_ref: { table?: string; id?: string } | null }[]
  >`
    SELECT id, title, properties, source_ref
    FROM ontology.nodes
    WHERE id = ${nodeId}::uuid AND user_id = ${userId}::uuid
      -- TODO: add "AND domain = 'service'" after domain column migration
  `;

  if (nodes.length === 0) {
    throw new Error('NODE_NOT_FOUND');
  }
  const node = nodes[0]!;

  // 2. Extract YouTube video ID from URL
  const url = node.properties?.['url'];
  if (typeof url !== 'string') {
    throw new Error('MISSING_URL');
  }
  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    throw new Error('NOT_YOUTUBE_URL');
  }

  // 3. Get transcript (auto-detect language: en → ko fallback)
  const captionExtractor = getCaptionExtractor();
  const captionResult = await captionExtractor.extractCaptions(videoId);
  if (!captionResult.success || !captionResult.caption) {
    throw new Error(`CAPTION_FAILED: ${captionResult.error || 'unknown'}`);
  }
  const transcript = captionResult.caption.fullText;
  const transcriptLang = captionResult.caption.language;

  // 4. Generate bilingual summary (en + ko)
  const generationProvider = await createGenerationProvider();
  const generate = (prompt: string, opts?: { format?: 'json' | 'text'; temperature?: number }) =>
    generationProvider.generate(prompt, opts);

  // 4a. Generate primary summary (in transcript's language)
  let primarySummary: SummaryResponse;
  if (transcript.length > CHUNK_THRESHOLD) {
    logger.info('Using chunked summarization', { transcriptLength: transcript.length, lang: transcriptLang });
    primarySummary = await chunkedSummarize(node.title, transcript, generate);
  } else {
    const rawResponse = await generate(
      buildSummaryPrompt(node.title, transcript),
      { format: 'json', temperature: 0.3 }
    );
    primarySummary = parseSummaryResponse(rawResponse);
  }

  // 4b. EN-first strategy: primary summary is always English → translate to Korean
  const summaryEn = primarySummary.summary;
  let summaryKo: string;

  try {
    const translated = await generate(
      `Translate to natural Korean in 2-3 sentences:\n${summaryEn}`,
      { temperature: 0.3 }
    );
    summaryKo = translated.trim();
  } catch {
    summaryKo = summaryEn; // fallback: same as en
  }

  const tags = primarySummary.tags;
  // Default summary for backward compatibility (English)
  const summary = summaryEn;

  logger.info('Bilingual summary generated', { nodeId, en: summaryEn.length, ko: summaryKo.length });

  // 5. Update node properties (bilingual summary + tags)
  const updatedProperties = {
    ...node.properties,
    summary,
    summary_en: summaryEn,
    summary_ko: summaryKo,
    summary_tags: tags,
  };

  await prisma.$executeRaw`
    UPDATE ontology.nodes
    SET properties = ${JSON.stringify(updatedProperties)}::jsonb,
        updated_at = now()
    WHERE id = ${nodeId}::uuid AND user_id = ${userId}::uuid
  `;

  // 5b. Write bilingual AI Summary to user_local_cards.user_note
  const sourceRef = node.source_ref as { table?: string; id?: string } | null;
  if (sourceRef?.table === 'user_local_cards' && sourceRef?.id) {
    const bilingualNote = `${AI_SUMMARY_PREFIX}${summaryEn}\n\n${AI_SUMMARY_PREFIX_KO}${summaryKo}`;

    // Get existing note to prepend/replace
    const existingRows = await prisma.$queryRaw<{ user_note: string | null }[]>`
      SELECT user_note FROM public.user_local_cards
      WHERE id = ${sourceRef.id}::uuid
    `;
    const existingNote = existingRows[0]?.user_note ?? '';

    let newNote: string;
    if (!existingNote) {
      newNote = bilingualNote;
    } else if (existingNote.startsWith(AI_SUMMARY_PREFIX)) {
      // Already has AI Summary: replace everything before user content
      // Find user content after the last AI Summary block
      const lastPrefixIdx = existingNote.lastIndexOf(AI_SUMMARY_PREFIX_KO);
      let userContent = '';
      if (lastPrefixIdx >= 0) {
        const afterKo = existingNote.indexOf('\n\n', lastPrefixIdx + AI_SUMMARY_PREFIX_KO.length);
        userContent = afterKo >= 0 ? existingNote.slice(afterKo) : '';
      } else {
        const afterEn = existingNote.indexOf('\n\n', AI_SUMMARY_PREFIX.length);
        userContent = afterEn >= 0 ? existingNote.slice(afterEn) : '';
      }
      newNote = bilingualNote + userContent;
    } else {
      newNote = bilingualNote + '\n\n' + existingNote;
    }

    await prisma.$executeRaw`
      UPDATE public.user_local_cards
      SET user_note = ${newNote}, updated_at = now()
      WHERE id = ${sourceRef.id}::uuid
    `;
  }

  // 6. Re-embed with enriched content
  const embedded = await embedNode(nodeId, node.title, updatedProperties);

  logger.info('Resource node enriched', { nodeId, videoId, tagsCount: tags.length, embedded });

  return { nodeId, summary, tags, embedded };
}

/**
 * Find resource node by source_ref (e.g., local_card ID) and enrich it.
 * If no resource node exists, auto-create one from the card data, then enrich.
 * Used for auto-enrichment after card creation.
 */
export async function enrichBySourceRef(
  userId: string,
  sourceTable: string,
  sourceId: string
): Promise<EnrichResult | null> {
  const prisma = getPrismaClient();

  // Look for existing resource node
  let nodes = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM ontology.nodes
    WHERE user_id = ${userId}::uuid
      AND type = 'resource'
      AND source_ref->>'table' = ${sourceTable}
      AND source_ref->>'id' = ${sourceId}
    LIMIT 1
  `;

  // Auto-create resource node if not found
  if (nodes.length === 0 && sourceTable === 'user_local_cards') {
    const cards = await prisma.$queryRaw<
      { id: string; url: string; title: string; link_type: string }[]
    >`
      SELECT id, url, COALESCE(title, metadata_title, 'Untitled') as title, link_type
      FROM public.user_local_cards
      WHERE id = ${sourceId}::uuid AND user_id = ${userId}::uuid
    `;

    if (cards.length === 0) {
      return null;
    }
    const card = cards[0]!;

    // Only create resource nodes for YouTube cards
    if (card.link_type !== 'youtube' && card.link_type !== 'youtube-shorts') {
      return null;
    }

    const sourceRef = JSON.stringify({ table: 'user_local_cards', id: card.id });
    const properties = JSON.stringify({ url: card.url, link_type: card.link_type });

    nodes = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref)
      VALUES (${userId}::uuid, 'resource', ${card.title}, ${properties}::jsonb, ${sourceRef}::jsonb)
      RETURNING id
    `;

    logger.info('Auto-created resource node for card', { cardId: sourceId, nodeId: nodes[0]!.id });
  }

  if (nodes.length === 0) {
    return null;
  }

  return enrichResourceNode(nodes[0]!.id, userId);
}

// ============================================================================
// Backfill — Create ontology resource nodes for existing YouTube cards
// ============================================================================

interface BackfillProgressEvent {
  current: number;
  total: number;
  cardId: string;
  title: string;
  status: 'created' | 'skipped' | 'error';
  error?: string;
}

export interface BackfillResult {
  total: number;
  created: number;
  skipped: number;
  errors: { cardId: string; error: string }[];
}

/**
 * Create ontology resource nodes for existing user_local_cards that don't have one.
 * This bridges the gap: cards → resource nodes → enrichment → user_note.
 */
export async function backfillResourceNodes(
  userId: string,
  options: { onProgress?: (event: BackfillProgressEvent) => void } = {}
): Promise<BackfillResult> {
  const prisma = getPrismaClient();

  // Find YouTube cards that have no corresponding ontology resource node
  const cards = await prisma.$queryRaw<
    { id: string; url: string; title: string; link_type: string }[]
  >`
    SELECT c.id, c.url, COALESCE(c.title, c.metadata_title, 'Untitled') as title, c.link_type
    FROM public.user_local_cards c
    WHERE c.user_id = ${userId}::uuid
      AND c.link_type IN ('youtube', 'youtube-shorts')
      AND NOT EXISTS (
        SELECT 1 FROM ontology.nodes n
        WHERE n.user_id = ${userId}::uuid
          AND n.type = 'resource'
          AND n.source_ref->>'table' = 'user_local_cards'
          AND n.source_ref->>'id' = c.id::text
      )
    ORDER BY c.created_at ASC
  `;

  const result: BackfillResult = {
    total: cards.length,
    created: 0,
    skipped: 0,
    errors: [],
  };

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]!;
    try {
      const sourceRef = JSON.stringify({ table: 'user_local_cards', id: card.id });
      const properties = JSON.stringify({ url: card.url, link_type: card.link_type });

      await prisma.$executeRaw`
        INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref)
        VALUES (
          ${userId}::uuid,
          'resource',
          ${card.title},
          ${properties}::jsonb,
          ${sourceRef}::jsonb
        )
      `;
      result.created++;
      options.onProgress?.({ current: i + 1, total: cards.length, cardId: card.id, title: card.title, status: 'created' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ cardId: card.id, error: msg });
      options.onProgress?.({ current: i + 1, total: cards.length, cardId: card.id, title: card.title, status: 'error', error: msg });
    }
  }

  logger.info('Backfill complete', { userId, total: result.total, created: result.created, errors: result.errors.length });
  return result;
}

const MAX_BATCH_LIMIT = 500;

export interface EnrichProgressEvent {
  current: number;
  total: number;
  nodeId: string;
  title: string;
  status: 'start' | 'success' | 'error';
  error?: string;
  summary?: string;
}

export async function batchEnrichResources(
  userId: string,
  options: { limit?: number; delayMs?: number; onProgress?: (event: EnrichProgressEvent) => void } = {}
): Promise<BatchEnrichResult> {
  const prisma = getPrismaClient();
  // limit=0 means "all" (capped at MAX_BATCH_LIMIT for safety)
  const rawLimit = options.limit ?? 10;
  const limit = rawLimit === 0 ? MAX_BATCH_LIMIT : Math.min(rawLimit, MAX_BATCH_LIMIT);
  const delayMs = options.delayMs ?? 2000;

  // Find resource nodes without summary, YouTube link_type
  const nodes = await prisma.$queryRaw<{ id: string; title: string }[]>`
    SELECT id, title FROM ontology.nodes
    WHERE user_id = ${userId}::uuid
      -- TODO: add "AND domain = 'service'" after domain column migration
      AND type = 'resource'
      AND (properties->>'link_type' = 'youtube' OR properties->>'url' LIKE '%youtube.com%' OR properties->>'url' LIKE '%youtu.be%')
      AND (properties->>'summary' IS NULL OR properties->>'summary' = '')
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;

  const onProgress = options.onProgress;
  const result: BatchEnrichResult = {
    total: nodes.length,
    enriched: 0,
    skipped: 0,
    errors: [],
  };

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    onProgress?.({ current: i + 1, total: nodes.length, nodeId: node.id, title: node.title, status: 'start' });

    try {
      const enrichResult = await enrichResourceNode(node.id, userId);
      result.enriched++;
      onProgress?.({ current: i + 1, total: nodes.length, nodeId: node.id, title: node.title, status: 'success', summary: enrichResult.summary });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ nodeId: node.id, error: msg });
      logger.warn('Batch enrich skipped node', { nodeId: node.id, error: msg });
      onProgress?.({ current: i + 1, total: nodes.length, nodeId: node.id, title: node.title, status: 'error', error: msg });
    }

    if (delayMs > 0 && i < nodes.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  logger.info('Batch enrichment complete', {
    userId,
    total: result.total,
    enriched: result.enriched,
    errors: result.errors.length,
  });

  return result;
}
