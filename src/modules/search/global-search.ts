/**
 * Global Search — unified user-data search behind the ⌘K palette (Phase 1).
 *
 * Four groups run in parallel, ALL scoped to the requesting user (R3):
 *   cards     — user_video_states JOIN youtube_videos (99.6% of placed cards)
 *               + user_local_cards (manual/link/file cards + memos)
 *   mandalas  — user_mandalas title + user_mandala_levels goal/labels/subjects
 *   notes     — note_documents.content_json (TipTap doc → extracted text snippet)
 *   summaries — video_rich_summaries.one_liner (v2; user-cards join. core body = Phase 2)
 *
 * Design: docs/design/global-search-cmdk-2026-07-02.md
 * Perf: worst-case measured 2026-07-02 (see design §3) — pg_trgm GIN indexes
 * (prisma/migrations/global-search/001) keep cards/summaries in the ms range.
 */
import { Prisma } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { logger } from '../../utils/logger';

export const SEARCH_GROUP_LIMIT_DEFAULT = 5;
export const SEARCH_GROUP_LIMIT_MAX = 20;
/** Per-group budget; a late group returns empty + partial:true (honest partial). */
export const SEARCH_GROUP_TIMEOUT_MS = 800;
export const SEARCH_SNIPPET_RADIUS = 60;
const SEARCH_QUERY_MAX_LEN = 100;

export interface CardHit {
  kind: 'video' | 'local';
  id: string;
  title: string | null;
  channelTitle: string | null;
  thumbnailUrl: string | null;
  url: string | null;
  videoId: string | null;
  note: string | null;
  mandalaId: string | null;
  cellIndex: number | null;
  createdAt: string;
}

export interface MandalaHit {
  id: string;
  title: string | null;
  centerLabel: string | null;
  createdAt: string;
}

export interface NoteHit {
  id: string;
  mandalaId: string;
  mandalaTitle: string | null;
  snippet: string;
  updatedAt: string;
}

export interface SummaryHit {
  videoId: string;
  oneLiner: string;
  videoTitle: string | null;
  mandalaId: string | null;
}

export interface SearchGroup<T> {
  items: T[];
  total: number;
  /** true = the group missed its time budget; items/total are incomplete. */
  partial: boolean;
}

export interface GlobalSearchResult {
  query: string;
  groups: {
    cards: SearchGroup<CardHit>;
    mandalas: SearchGroup<MandalaHit>;
    notes: SearchGroup<NoteHit>;
    summaries: SearchGroup<SummaryHit>;
  };
  tookMs: number;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-tested)
// ---------------------------------------------------------------------------

/** Escape LIKE/ILIKE metacharacters so user input matches literally. */
export function escapeLikePattern(raw: string): string {
  return raw.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/** Depth-first text extraction from a TipTap/ProseMirror JSON doc. */
export function extractTiptapText(node: unknown): string {
  if (node == null || typeof node !== 'object') return '';
  const n = node as { text?: unknown; content?: unknown };
  const parts: string[] = [];
  if (typeof n.text === 'string') parts.push(n.text);
  if (Array.isArray(n.content)) {
    for (const child of n.content) parts.push(extractTiptapText(child));
  }
  return parts.join(' ');
}

/** Case-insensitive snippet around the first query hit (±radius chars). */
export function makeSnippet(text: string, query: string, radius = SEARCH_SNIPPET_RADIUS): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  const idx = compact.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return compact.slice(0, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(compact.length, idx + query.length + radius);
  return `${start > 0 ? '…' : ''}${compact.slice(start, end)}${end < compact.length ? '…' : ''}`;
}

/** Merge the two card sources: title matches first, then recency; cap at limit. */
export function mergeCardHits(hits: CardHit[], query: string, limit: number): CardHit[] {
  const q = query.toLowerCase();
  const titleMatch = (h: CardHit) => ((h.title ?? '').toLowerCase().includes(q) ? 0 : 1);
  return [...hits]
    .sort((a, b) => titleMatch(a) - titleMatch(b) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
}

/** Resolve a group promise against the time budget; late = empty + partial. */
export async function withGroupTimeout<T>(
  work: Promise<SearchGroup<T>>,
  timeoutMs = SEARCH_GROUP_TIMEOUT_MS
): Promise<SearchGroup<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<SearchGroup<T>>((resolve) => {
    timer = setTimeout(() => resolve({ items: [], total: 0, partial: true }), timeoutMs);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Group queries (parameterized via Prisma.sql — never string-interpolated)
// ---------------------------------------------------------------------------

async function searchCards(userId: string, pattern: string, query: string, limit: number) {
  const prisma = getPrismaClient();
  const [videoRows, videoCount, localRows, localCount] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        id: string;
        video_id: string | null;
        title: string | null;
        channel_title: string | null;
        thumbnail_url: string | null;
        user_note: string | null;
        mandala_id: string | null;
        cell_index: number | null;
        created_at: Date;
      }>
    >(Prisma.sql`
      SELECT s.id, v.youtube_video_id AS video_id, v.title, v.channel_title,
             v.thumbnail_url, s.user_note, s.mandala_id, s.cell_index, s.created_at
      FROM user_video_states s
      JOIN youtube_videos v ON v.id = s.video_id
      WHERE s.user_id = ${userId}::uuid
        AND (v.title ILIKE ${pattern} OR v.channel_title ILIKE ${pattern} OR s.user_note ILIKE ${pattern})
      ORDER BY (v.title ILIKE ${pattern}) DESC, s.created_at DESC
      LIMIT ${limit}`),
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT count(*)::int AS n
      FROM user_video_states s
      JOIN youtube_videos v ON v.id = s.video_id
      WHERE s.user_id = ${userId}::uuid
        AND (v.title ILIKE ${pattern} OR v.channel_title ILIKE ${pattern} OR s.user_note ILIKE ${pattern})`),
    prisma.$queryRaw<
      Array<{
        id: string;
        title: string | null;
        user_note: string | null;
        url: string | null;
        thumbnail: string | null;
        video_id: string | null;
        mandala_id: string | null;
        cell_index: number | null;
        created_at: Date;
      }>
    >(Prisma.sql`
      SELECT id, title, user_note, url, thumbnail, video_id, mandala_id, cell_index, created_at
      FROM user_local_cards
      WHERE user_id = ${userId}::uuid
        AND (title ILIKE ${pattern} OR user_note ILIKE ${pattern} OR url ILIKE ${pattern}
             OR metadata_title ILIKE ${pattern} OR metadata_description ILIKE ${pattern})
      ORDER BY (title ILIKE ${pattern}) DESC, created_at DESC
      LIMIT ${limit}`),
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT count(*)::int AS n
      FROM user_local_cards
      WHERE user_id = ${userId}::uuid
        AND (title ILIKE ${pattern} OR user_note ILIKE ${pattern} OR url ILIKE ${pattern}
             OR metadata_title ILIKE ${pattern} OR metadata_description ILIKE ${pattern})`),
  ]);

  const hits: CardHit[] = [
    ...videoRows.map((r) => ({
      kind: 'video' as const,
      id: r.id,
      title: r.title,
      channelTitle: r.channel_title,
      thumbnailUrl: r.thumbnail_url,
      url: null,
      videoId: r.video_id,
      note: r.user_note,
      mandalaId: r.mandala_id,
      cellIndex: r.cell_index,
      createdAt: r.created_at.toISOString(),
    })),
    ...localRows.map((r) => ({
      kind: 'local' as const,
      id: r.id,
      title: r.title,
      channelTitle: null,
      thumbnailUrl: r.thumbnail,
      url: r.url,
      videoId: r.video_id,
      note: r.user_note,
      mandalaId: r.mandala_id,
      cellIndex: r.cell_index,
      createdAt: r.created_at.toISOString(),
    })),
  ];

  return {
    items: mergeCardHits(hits, query, limit),
    total: (videoCount[0]?.n ?? 0) + (localCount[0]?.n ?? 0),
    partial: false,
  };
}

async function searchMandalas(userId: string, pattern: string, limit: number) {
  const prisma = getPrismaClient();
  const cellMatch = Prisma.sql`EXISTS (
    SELECT 1 FROM user_mandala_levels l
    WHERE l.mandala_id = m.id
      AND (l.center_goal ILIKE ${pattern} OR l.center_label ILIKE ${pattern}
           OR array_to_string(l.subjects, ' ') ILIKE ${pattern}
           OR array_to_string(l.subject_labels, ' ') ILIKE ${pattern}))`;
  const [rows, count] = await Promise.all([
    prisma.$queryRaw<
      Array<{ id: string; title: string | null; center_label: string | null; created_at: Date }>
    >(Prisma.sql`
      SELECT m.id, m.title,
             (SELECT l.center_label FROM user_mandala_levels l
              WHERE l.mandala_id = m.id AND l.depth = 0 LIMIT 1) AS center_label,
             m.created_at
      FROM user_mandalas m
      WHERE m.user_id = ${userId}::uuid AND (m.title ILIKE ${pattern} OR ${cellMatch})
      ORDER BY (m.title ILIKE ${pattern}) DESC, m.created_at DESC
      LIMIT ${limit}`),
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT count(*)::int AS n
      FROM user_mandalas m
      WHERE m.user_id = ${userId}::uuid AND (m.title ILIKE ${pattern} OR ${cellMatch})`),
  ]);
  const items: MandalaHit[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    centerLabel: r.center_label,
    createdAt: r.created_at.toISOString(),
  }));
  return { items, total: count[0]?.n ?? 0, partial: false };
}

async function searchNotes(userId: string, pattern: string, query: string, limit: number) {
  const prisma = getPrismaClient();
  const [rows, count] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        id: string;
        mandala_id: string;
        mandala_title: string | null;
        content_json: unknown;
        updated_at: Date;
      }>
    >(Prisma.sql`
      SELECT n.id, n.mandala_id, m.title AS mandala_title, n.content_json, n.updated_at
      FROM note_documents n
      LEFT JOIN user_mandalas m ON m.id = n.mandala_id
      WHERE n.user_id = ${userId}::uuid AND n.content_json::text ILIKE ${pattern}
      ORDER BY n.updated_at DESC
      LIMIT ${limit}`),
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT count(*)::int AS n
      FROM note_documents n
      WHERE n.user_id = ${userId}::uuid AND n.content_json::text ILIKE ${pattern}`),
  ]);
  const items: NoteHit[] = rows.map((r) => ({
    id: r.id,
    mandalaId: r.mandala_id,
    mandalaTitle: r.mandala_title,
    snippet: makeSnippet(extractTiptapText(r.content_json), query),
    updatedAt: r.updated_at.toISOString(),
  }));
  return { items, total: count[0]?.n ?? 0, partial: false };
}

async function searchSummaries(userId: string, pattern: string, limit: number) {
  const prisma = getPrismaClient();
  const [rows, count] = await Promise.all([
    prisma.$queryRaw<
      Array<{
        video_id: string;
        one_liner: string;
        video_title: string | null;
        mandala_id: string | null;
      }>
    >(Prisma.sql`
      SELECT DISTINCT ON (vrs.video_id)
             vrs.video_id, vrs.one_liner, v.title AS video_title, s.mandala_id
      FROM video_rich_summaries vrs
      JOIN youtube_videos v ON v.youtube_video_id = vrs.video_id
      JOIN user_video_states s ON s.video_id = v.id AND s.user_id = ${userId}::uuid
      WHERE vrs.one_liner ILIKE ${pattern}
      ORDER BY vrs.video_id, s.created_at DESC
      LIMIT ${limit}`),
    prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT count(DISTINCT vrs.video_id)::int AS n
      FROM video_rich_summaries vrs
      JOIN youtube_videos v ON v.youtube_video_id = vrs.video_id
      JOIN user_video_states s ON s.video_id = v.id AND s.user_id = ${userId}::uuid
      WHERE vrs.one_liner ILIKE ${pattern}`),
  ]);
  const items: SummaryHit[] = rows.map((r) => ({
    videoId: r.video_id,
    oneLiner: r.one_liner,
    videoTitle: r.video_title,
    mandalaId: r.mandala_id,
  }));
  return { items, total: count[0]?.n ?? 0, partial: false };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const EMPTY_GROUP = { items: [], total: 0, partial: false } as const;

export async function globalSearch(
  userId: string,
  rawQuery: string,
  options: { limitPerGroup?: number } = {}
): Promise<GlobalSearchResult> {
  const started = Date.now();
  const query = rawQuery.trim().slice(0, SEARCH_QUERY_MAX_LEN);
  const limit = Math.min(
    Math.max(options.limitPerGroup ?? SEARCH_GROUP_LIMIT_DEFAULT, 1),
    SEARCH_GROUP_LIMIT_MAX
  );

  if (query.length === 0) {
    return {
      query,
      groups: {
        cards: { ...EMPTY_GROUP, items: [] },
        mandalas: { ...EMPTY_GROUP, items: [] },
        notes: { ...EMPTY_GROUP, items: [] },
        summaries: { ...EMPTY_GROUP, items: [] },
      },
      tookMs: Date.now() - started,
    };
  }

  const pattern = `%${escapeLikePattern(query)}%`;
  const guarded = <T>(work: Promise<SearchGroup<T>>, group: string): Promise<SearchGroup<T>> =>
    withGroupTimeout(
      work.catch((err) => {
        logger.warn('[global-search] group query failed (degraded)', {
          group,
          error: err instanceof Error ? err.message : String(err),
        });
        return { items: [] as T[], total: 0, partial: true };
      })
    );

  const [cards, mandalas, notes, summaries] = await Promise.all([
    guarded(searchCards(userId, pattern, query, limit), 'cards'),
    guarded(searchMandalas(userId, pattern, limit), 'mandalas'),
    guarded(searchNotes(userId, pattern, query, limit), 'notes'),
    guarded(searchSummaries(userId, pattern, limit), 'summaries'),
  ]);

  return { query, groups: { cards, mandalas, notes, summaries }, tookMs: Date.now() - started };
}
