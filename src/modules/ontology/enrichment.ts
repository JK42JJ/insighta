import { getPrismaClient } from '../database/client';
import { getCaptionExtractor } from '../caption/extractor';
import { createGenerationProvider } from '../llm';
import { embedNode } from './embedding';
import { logger } from '../../utils/logger';

// ============================================================================
// Video Enrichment — YouTube transcript → LLM summary → video_summaries table
// ============================================================================

const MAX_TRANSCRIPT_CHARS = 10000;

// Chunked summarization constants (qwen3.5:9b limitation: >500 chars → empty response)
const CHUNK_THRESHOLD = 500;
const MAX_CHUNK_SIZE = 300;
const MAX_MERGE_INPUT = 400;

// ============================================================================
// Types
// ============================================================================

export interface VideoSummaryResult {
  videoId: string;
  summaryEn: string;
  summaryKo: string;
  tags: string[];
  model: string;
  cached: boolean;
}

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
  errors: { videoId: string; error: string }[];
}

interface SummaryResponse {
  summary: string;
  tags: string[];
}

// ============================================================================
// Helpers
// ============================================================================

export function extractYouTubeVideoId(url: string): string | null {
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

function parseSummaryResponse(raw: string): SummaryResponse {
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

function splitIntoParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

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

function packChunks(paragraphs: string[], maxSize: number): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const para of paragraphs) {
    if (para.length > maxSize) {
      if (current.trim()) {
        chunks.push(current.trim());
        current = '';
      }
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

async function reducePartials(
  partials: string[],
  generate: (prompt: string) => Promise<string>,
  depth: number = 0
): Promise<string[]> {
  const totalSize = partials.reduce((sum, p) => sum + p.length + 3, 0);
  if (totalSize <= MAX_MERGE_INPUT) {
    return partials;
  }

  if (depth >= MAX_REDUCE_DEPTH) {
    logger.warn('reducePartials max depth reached, truncating', {
      depth,
      partials: partials.length,
    });
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

  const BATCH_SIZE = 4;
  const batches: string[][] = [];
  for (let i = 0; i < partials.length; i += BATCH_SIZE) {
    batches.push(partials.slice(i, i + BATCH_SIZE));
  }

  const reduced: string[] = [];
  for (const group of batches) {
    if (group.length === 1) {
      const prompt = `Shorten to 1 sentence:\n${group[0]}`;
      const result = await generate(prompt);
      reduced.push(result.trim().slice(0, 120));
      continue;
    }
    const prompt = `Combine into 1 sentence:\n${group.map((g) => `- ${g}`).join('\n')}`;
    const result = await generate(prompt);
    reduced.push(result.trim().slice(0, 120));
  }

  const reducedSize = reduced.reduce((sum, p) => sum + p.length + 3, 0);
  if (reducedSize > MAX_MERGE_INPUT && reduced.length > 1) {
    return reducePartials(reduced, generate, depth + 1);
  }

  return reduced;
}

async function chunkedSummarize(
  title: string,
  transcript: string,
  generate: (
    prompt: string,
    options?: { format?: 'json' | 'text'; temperature?: number }
  ) => Promise<string>
): Promise<SummaryResponse> {
  const truncated = transcript.slice(0, MAX_TRANSCRIPT_CHARS);
  const paragraphs = splitIntoParagraphs(truncated);
  const chunks = packChunks(paragraphs, MAX_CHUNK_SIZE);

  logger.info('Chunked summarization', { chunks: chunks.length, totalChars: truncated.length });

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

  const plainGenerate = (p: string) => generate(p, { temperature: 0.3 });
  const reducedPartials = await reducePartials(partials, plainGenerate);

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

// ============================================================================
// Core: enrichVideo — video_id based, UPSERT to video_summaries
// ============================================================================

/**
 * Generate or retrieve summary for a YouTube video.
 * Results are stored in video_summaries table (1 row per video_id).
 * No user_note writes. No user_id dependency.
 */
export async function enrichVideo(
  videoId: string,
  options?: { transcript?: string; force?: boolean; title?: string; url?: string }
): Promise<VideoSummaryResult> {
  const prisma = getPrismaClient();

  // 1. Check if summary already exists (skip unless force)
  if (!options?.force) {
    const existing = await prisma.$queryRaw<
      {
        video_id: string;
        summary_en: string | null;
        summary_ko: string | null;
        tags: string[];
        model: string | null;
      }[]
    >`
      SELECT video_id, summary_en, summary_ko, tags, model
      FROM public.video_summaries
      WHERE video_id = ${videoId}
    `;

    const hit = existing[0];
    if (hit?.summary_en) {
      logger.info('Video summary cache hit', { videoId });
      return {
        videoId,
        summaryEn: hit.summary_en,
        summaryKo: hit.summary_ko || hit.summary_en,
        tags: hit.tags || [],
        model: hit.model || '',
        cached: true,
      };
    }
  }

  // 2. Get transcript
  let transcript: string;
  let transcriptSegments = 0;

  if (options?.transcript) {
    transcript = options.transcript;
    logger.info('Using client-provided transcript', { videoId, length: transcript.length });
  } else {
    const captionExtractor = getCaptionExtractor();
    const captionResult = await captionExtractor.extractCaptions(videoId);
    if (!captionResult.success || !captionResult.caption) {
      throw new Error(`CAPTION_FAILED: ${captionResult.error || 'unknown'}`);
    }
    transcript = captionResult.caption.fullText;
    transcriptSegments = captionResult.caption.segments?.length ?? 0;
  }

  // 3. Generate bilingual summary
  const title = options?.title || videoId;
  const generationProvider = await createGenerationProvider();
  const generate = (prompt: string, opts?: { format?: 'json' | 'text'; temperature?: number }) =>
    generationProvider.generate(prompt, opts);

  let primarySummary: SummaryResponse;
  if (transcript.length > CHUNK_THRESHOLD) {
    logger.info('Using chunked summarization', { videoId, transcriptLength: transcript.length });
    primarySummary = await chunkedSummarize(title, transcript, generate);
  } else {
    const rawResponse = await generate(buildSummaryPrompt(title, transcript), {
      format: 'json',
      temperature: 0.3,
    });
    primarySummary = parseSummaryResponse(rawResponse);
  }

  const summaryEn = primarySummary.summary;
  let summaryKo: string;

  try {
    const translated = await generate(
      `Translate to natural Korean in 2-3 sentences:\n${summaryEn}`,
      { temperature: 0.3 }
    );
    summaryKo = translated.trim();
  } catch {
    summaryKo = summaryEn;
  }

  const tags = primarySummary.tags;
  const modelName = generationProvider.model;

  logger.info('Bilingual summary generated', {
    videoId,
    en: summaryEn.length,
    ko: summaryKo.length,
  });

  // 4. UPSERT to video_summaries
  const url = options?.url || `https://www.youtube.com/watch?v=${videoId}`;
  const tagsArray = `{${tags.map((t) => `"${t.replace(/"/g, '\\"')}"`).join(',')}}`;

  await prisma.$executeRaw`
    INSERT INTO public.video_summaries (video_id, url, title, summary_en, summary_ko, tags, model, transcript_segments, created_at, updated_at)
    VALUES (${videoId}, ${url}, ${title}, ${summaryEn}, ${summaryKo}, ${tagsArray}::text[], ${modelName}, ${transcriptSegments}, now(), now())
    ON CONFLICT (video_id) DO UPDATE SET
      summary_en = EXCLUDED.summary_en,
      summary_ko = EXCLUDED.summary_ko,
      tags = EXCLUDED.tags,
      model = EXCLUDED.model,
      transcript_segments = EXCLUDED.transcript_segments,
      title = COALESCE(EXCLUDED.title, public.video_summaries.title),
      updated_at = now()
  `;

  logger.info('Video summary saved', { videoId, tagsCount: tags.length, model: modelName });

  return {
    videoId,
    summaryEn,
    summaryKo,
    tags,
    model: modelName,
    cached: false,
  };
}

// ============================================================================
// Legacy adapter: enrichResourceNode — wraps enrichVideo + updates ontology.nodes
// ============================================================================

export async function enrichResourceNode(
  nodeId: string,
  userId: string,
  options?: { transcript?: string }
): Promise<EnrichResult> {
  const prisma = getPrismaClient();

  // 1. Get resource node
  const nodes = await prisma.$queryRaw<
    { id: string; title: string; properties: Record<string, unknown> }[]
  >`
    SELECT id, title, properties
    FROM ontology.nodes
    WHERE id = ${nodeId}::uuid AND user_id = ${userId}::uuid
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

  // 3. Delegate to enrichVideo (central summary)
  const result = await enrichVideo(videoId, {
    transcript: options?.transcript,
    title: node.title,
    url,
  });

  // 4. Update ontology.nodes properties (graph usage)
  const updatedProperties = {
    ...node.properties,
    summary: result.summaryEn,
    summary_en: result.summaryEn,
    summary_ko: result.summaryKo,
    summary_tags: result.tags,
    summary_model: result.model,
    summary_created_at: new Date().toISOString(),
  };

  await prisma.$executeRaw`
    UPDATE ontology.nodes
    SET properties = ${JSON.stringify(updatedProperties)}::jsonb,
        updated_at = now()
    WHERE id = ${nodeId}::uuid AND user_id = ${userId}::uuid
  `;

  // 5. Re-embed (non-fatal)
  let embedded = false;
  try {
    embedded = await embedNode(nodeId, node.title, updatedProperties);
  } catch (err) {
    logger.warn('Embedding failed (non-fatal)', {
      nodeId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info('Resource node enriched', {
    nodeId,
    videoId,
    tagsCount: result.tags.length,
    embedded,
  });

  return { nodeId, summary: result.summaryEn, tags: result.tags, embedded };
}

// ============================================================================
// enrichBySourceRef — find/create resource node, then enrich
// ============================================================================

export async function enrichBySourceRef(
  userId: string,
  sourceTable: string,
  sourceId: string,
  options?: { force?: boolean; transcript?: string }
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

  // Auto-create resource node for synced YouTube video states
  if (nodes.length === 0 && sourceTable === 'user_video_states') {
    const videoStates = await prisma.$queryRaw<
      { id: string; youtube_video_id: string; title: string }[]
    >`
      SELECT uvs.id, yv.youtube_video_id, yv.title
      FROM public.user_video_states uvs
      JOIN public.youtube_videos yv ON uvs.video_id = yv.id
      WHERE uvs.id = ${sourceId}::uuid AND uvs.user_id = ${userId}::uuid
    `;

    if (videoStates.length === 0) {
      return null;
    }
    const vs = videoStates[0]!;

    const sourceRef = JSON.stringify({ table: 'user_video_states', id: vs.id });
    const url = `https://www.youtube.com/watch?v=${vs.youtube_video_id}`;
    const properties = JSON.stringify({ url, link_type: 'youtube' });

    nodes = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref)
      VALUES (${userId}::uuid, 'resource', ${vs.title}, ${properties}::jsonb, ${sourceRef}::jsonb)
      RETURNING id
    `;

    logger.info('Auto-created resource node for video state', {
      videoStateId: sourceId,
      nodeId: nodes[0]!.id,
    });
  }

  if (nodes.length === 0) {
    return null;
  }

  const nodeId = nodes[0]!.id;

  // Check summary_dismissed flag
  if (!options?.force) {
    const nodeData = await prisma.$queryRaw<{ properties: Record<string, unknown> }[]>`
      SELECT properties FROM ontology.nodes WHERE id = ${nodeId}::uuid AND user_id = ${userId}::uuid
    `;
    if (nodeData[0]?.properties?.['summary_dismissed'] === true) {
      return null;
    }
  } else {
    await prisma.$executeRaw`
      UPDATE ontology.nodes
      SET properties = properties - 'summary_dismissed', updated_at = now()
      WHERE id = ${nodeId}::uuid AND user_id = ${userId}::uuid
    `;
  }

  return enrichResourceNode(nodeId, userId, { transcript: options?.transcript });
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

export async function backfillResourceNodes(
  userId: string,
  options: { onProgress?: (event: BackfillProgressEvent) => void } = {}
): Promise<BackfillResult> {
  const prisma = getPrismaClient();

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
      options.onProgress?.({
        current: i + 1,
        total: cards.length,
        cardId: card.id,
        title: card.title,
        status: 'created',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ cardId: card.id, error: msg });
      options.onProgress?.({
        current: i + 1,
        total: cards.length,
        cardId: card.id,
        title: card.title,
        status: 'error',
        error: msg,
      });
    }
  }

  logger.info('Backfill complete', {
    userId,
    total: result.total,
    created: result.created,
    errors: result.errors.length,
  });
  return result;
}

// ============================================================================
// Batch Enrich — legacy (user-scoped, uses ontology.nodes)
// ============================================================================

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
  options: {
    limit?: number;
    delayMs?: number;
    onProgress?: (event: EnrichProgressEvent) => void;
  } = {}
): Promise<BatchEnrichResult> {
  const prisma = getPrismaClient();
  const rawLimit = options.limit ?? 10;
  const limit = rawLimit === 0 ? MAX_BATCH_LIMIT : Math.min(rawLimit, MAX_BATCH_LIMIT);
  const delayMs = options.delayMs ?? 2000;

  const nodes = await prisma.$queryRaw<{ id: string; title: string }[]>`
    SELECT id, title FROM ontology.nodes
    WHERE user_id = ${userId}::uuid
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
    onProgress?.({
      current: i + 1,
      total: nodes.length,
      nodeId: node.id,
      title: node.title,
      status: 'start',
    });

    try {
      const enrichResult = await enrichResourceNode(node.id, userId);
      result.enriched++;
      onProgress?.({
        current: i + 1,
        total: nodes.length,
        nodeId: node.id,
        title: node.title,
        status: 'success',
        summary: enrichResult.summary,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ videoId: node.id, error: msg });
      logger.warn('Batch enrich skipped node', { nodeId: node.id, error: msg });
      onProgress?.({
        current: i + 1,
        total: nodes.length,
        nodeId: node.id,
        title: node.title,
        status: 'error',
        error: msg,
      });
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

// ============================================================================
// System Batch Enrich — no user auth, scans all cards for unsummarized videos
// ============================================================================

export interface SystemBatchResult {
  total: number;
  enriched: number;
  skipped: number;
  errors: { videoId: string; error: string }[];
}

const SYSTEM_BATCH_DELAY_MS = 2000;

/**
 * Scan all user_local_cards for YouTube URLs, extract unique video_ids,
 * and enrich any that don't have a video_summaries entry.
 * No user authentication required — this is a system/admin operation.
 */
export async function systemBatchEnrich(
  options: { limit?: number; delayMs?: number } = {}
): Promise<SystemBatchResult> {
  const prisma = getPrismaClient();
  const limit = Math.min(options.limit ?? 100, MAX_BATCH_LIMIT);
  const delayMs = options.delayMs ?? SYSTEM_BATCH_DELAY_MS;

  // Find YouTube videos (local cards + synced) not yet in video_summaries
  const cards = await prisma.$queryRaw<{ vid: string; title: string }[]>`
    SELECT vid, title FROM (
      SELECT DISTINCT ON (c.url)
        extract_youtube_vid(c.url) as vid,
        COALESCE(c.title, c.metadata_title, 'Untitled') as title
      FROM public.user_local_cards c
      WHERE c.link_type IN ('youtube', 'youtube-shorts')

      UNION ALL

      SELECT DISTINCT ON (yv.youtube_video_id)
        yv.youtube_video_id as vid,
        yv.title
      FROM public.youtube_videos yv
    ) combined
    WHERE vid IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.video_summaries vs WHERE vs.video_id = combined.vid
      )
    LIMIT ${limit}
  `;

  const result: SystemBatchResult = {
    total: cards.length,
    enriched: 0,
    skipped: 0,
    errors: [],
  };

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]!;
    const videoId = card.vid;

    if (!videoId) {
      result.skipped++;
      continue;
    }

    try {
      const url = `https://www.youtube.com/watch?v=${videoId}`;
      await enrichVideo(videoId, { title: card.title, url });
      result.enriched++;
      logger.info('System batch enriched', { videoId, progress: `${i + 1}/${cards.length}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push({ videoId, error: msg });
      logger.warn('System batch enrich failed', { videoId, error: msg });
    }

    if (delayMs > 0 && i < cards.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  logger.info('System batch enrichment complete', {
    total: result.total,
    enriched: result.enriched,
    skipped: result.skipped,
    errors: result.errors.length,
  });

  return result;
}
