/**
 * src/modules/chatbot-rag/types.ts
 *
 * Shared types for Insighta chatbot RAG pipeline.
 *
 * Consumed by:
 *   - user-context-loader.ts  → emits UserContext
 *   - video-context-loader.ts → emits V2Summary | TranscriptContext
 *   - retriever.ts            → emits RAGContext
 *   - qwen-runpod-adapter.ts  → orchestrates loaders + prompt-builder
 *   - prompt-builder.ts       → consumes all of the above to render the
 *                               SFT-aligned Qwen system prompt
 *
 * Design: docs/design/insighta-chatbot-prompt-serving-design.md §3 + CP474 review.
 *
 * NOTE: V2Summary, MandalaContext, RegionContext, ChatLayer, Lang are
 * already exported by prompt-builder.ts (SSOT). Re-importing here would
 * create a cycle, so we re-export only the structurally-new types in this
 * file. Callers that need ChatLayer/Lang should import from prompt-builder
 * directly.
 */

import type { Lang } from './prompt-builder';

// ============================================================================
// User session context (NEW — Block U in the SFT-aligned prompt)
// ============================================================================

/**
 * Per-user session context inlined into the chatbot system prompt.
 *
 * Source of truth:
 *   - tier              ← user_subscriptions.tier
 *   - mandala_titles    ← user_mandalas.title (most-recent first, capped at MAX_MANDALA_TITLES)
 *   - mandala_count     ← user_mandalas count
 *   - recent_card_count ← user_local_cards count in the last RECENT_DAYS_WINDOW days
 *   - join_date         ← users.created_at (or user_subscriptions.created_at as fallback)
 *   - email / display_name ← decoded JWT claims (request.user)
 *
 * NEVER includes secrets or PII beyond display_name + email.
 */
export interface UserContext {
  user_id: string;
  display_name: string;
  email: string;
  tier: 'free' | 'pro' | 'lifetime' | 'admin';
  /** ISO date (YYYY-MM-DD). Empty string when unknown. */
  join_date: string;
  /** Days since join_date; 0 when join_date is unknown. */
  days_active: number;
  mandala_count: number;
  /** Up to MAX_MANDALA_TITLES titles, most-recent first. */
  mandala_titles: string[];
  /** Title of the mandala currently in focus (from request context); undefined when out-of-mandala. */
  current_mandala_name?: string;
  // NOTE: per-mandala details (cards list, book chapters, note) now live
  // in dedicated Blocks J / I / N respectively — see types below. Keeping
  // them out of UserContext avoids prompt duplication and lets each
  // loader fail independently.
  recent_card_count_7d: number;
  preferred_language: Lang;
}

// ============================================================================
// Block J — Mandala card list (CP477+15)
//
// Mirrors the LeftPanel sidebar: `user_local_cards WHERE user_id AND
// mandala_id AND cell_index >= 0`. The sidebar's "10개 영상" count comes
// from this exact query, so the chatbot must use the same source to give
// consistent answers ("만다라에 영상 몇개?").
// ============================================================================

export interface MandalaCardSummary {
  /** YouTube 11-char id if the card is a video; null for non-video link types. */
  video_id: string | null;
  /** Human-set title (falls back to metadata_title). */
  title: string;
  /** 1-indexed cell position 1..8 (cell_index in DB; -1 = scratchpad — excluded). */
  cell_index: number;
  /** Optional cell label resolved from user_mandala_levels.subjects. */
  cell_name?: string;
}

export interface MandalaCardsContext {
  mandala_id: string;
  total_count: number;
  /** Up to MAX_MANDALA_CARDS items, most-recently-added first. */
  cards: MandalaCardSummary[];
}

// ============================================================================
// Block I — Mandala book index (CP477+15)
//
// Compact summary of `mandala_books.book_json`: chapter titles + section
// titles. Atoms / qa are deliberately excluded — they would inflate the
// prompt 5-10x with no proportional answer-quality gain (the model can
// ask follow-ups against video context for atom-level detail).
// ============================================================================

export interface MandalaBookSectionSummary {
  title: string;
  /** Number of atoms in this section, for "이 챕터에 얼마나 자세한 내용이 있어?" type queries. */
  atom_count: number;
}

export interface MandalaBookChapterSummary {
  ch: number;
  title: string;
  intro?: string;
  sections: MandalaBookSectionSummary[];
}

export interface MandalaBookContext {
  mandala_id: string;
  mandala_title: string;
  source_videos: number;
  source_atoms: number;
  /** Up to MAX_BOOK_CHAPTERS chapters. */
  chapters: MandalaBookChapterSummary[];
  /**
   * CP477+15 (Round 3) — Unique video ids surfaced by the book's atoms.
   * Per user clarification: the sidebar's "N개 영상" count derives from
   * this list (북마크 → v2 상세요약 → 북인덱스 atoms entry), so the chatbot
   * needs this exact source to answer "이 만다라 영상 몇개?" with the
   * number the user sees.
   */
  book_video_ids: string[];
  /**
   * CP477+15 (Round 3) — Titles for `book_video_ids` (resolved from
   * `youtube_videos.title` JOIN). Empty when the title lookup fails;
   * chatbot still has the count.
   */
  book_video_titles: string[];
}

// ============================================================================
// Block N — Note draft context (CP477+15)
//
// Compact excerpt of `note_documents.content_json` for the current
// (user, mandala). TipTap JSON is flattened to plain text and capped at
// MAX_NOTE_EXCERPT_CHARS — enough for the chatbot to ground "내 노트에
// 뭐 있어?" or "이 부분 어떻게 정리해?" type queries without bloating
// the prompt.
// ============================================================================

export interface NoteDraftContext {
  mandala_id: string;
  total_chars: number;
  excerpt: string;
  truncated: boolean;
  last_edited_at: string;
}

// ============================================================================
// Transcript fallback (NEW — Block T in the SFT-aligned prompt)
// ============================================================================

/**
 * Raw YouTube caption text used when no v2 rich summary is available
 * for the current video. The chatbot is instructed (via Block T's role
 * rule) to answer strictly from this transcript, not to fabricate.
 *
 * Source: src/modules/caption/extractor.ts
 *   - Primary: MAC_MINI_TRANSCRIPT_URL (Tailscale fetch, residential IP)
 *   - Fallback: youtube-transcript npm package directly from EC2
 *   - Both fail → caller passes null TranscriptContext + sets has_no_content
 */
export interface TranscriptContext {
  full_text: string;
  /** Origin of the transcript, used for source attribution in prompt. */
  source: 'mac-mini' | 'youtube-transcript' | 'cached';
  /** ISO 639-1 code or 'auto' when the extractor's language probe is ambiguous. */
  language: Lang | 'auto';
  /** True when full_text was clipped to fit TRANSCRIPT_PROMPT_MAX_CHARS. */
  truncated: boolean;
  total_chars: number;
}

// ============================================================================
// RAG retrieval (NEW — Block H in the SFT-aligned prompt)
// ============================================================================

/** Kind of artefact the RAG retriever surfaced for the user. */
export type RAGSourceType = 'card' | 'note' | 'kg_node';

/**
 * A single retrieval hit. Rendered in Block H with source attribution
 * (the SFT rule mandates explicit citation, e.g. "당신이 학습한 X 영상에서도…").
 */
export interface RAGResult {
  source_type: RAGSourceType;
  /** Human-readable label for the source (video title / note title / KG concept). */
  title: string;
  /** 1-3 sentence excerpt or canonical statement from the source. */
  excerpt: string;
  /** Mandala the source was attached to, when applicable. */
  mandala_name?: string;
  /** Cell within the mandala, when applicable. */
  cell_name?: string;
  /** ISO date when the source was saved / created. */
  date?: string;
  /** Cosine similarity score from the embedding retrieval, when applicable. */
  similarity?: number;
  /** For kg_node results: surfaced concept edges with their card counts. */
  kg_links?: { concept: string; card_count: number }[];
}

/**
 * Wrapper around the retriever's output. Carries the originating query
 * so that downstream log/cache layers can correlate.
 */
export interface RAGContext {
  results: RAGResult[];
  query: string;
  /** ISO timestamp when the retrieval ran. */
  retrieved_at: string;
}

// ============================================================================
// Constants (module-level — shared across loaders)
// ============================================================================

/** Cap on mandala_titles array length to keep system prompt size bounded. */
export const MAX_MANDALA_TITLES = 10;

/**
 * CP477+15 — Cap on per-mandala card list in Block J. Higher than the
 * sidebar's count display but still bounded to keep the prompt small.
 * If the mandala has more cards the chatbot can ask for clarification
 * about which cell the user means.
 */
export const MAX_MANDALA_CARDS = 24;

/**
 * CP477+15 — Cap on chapters surfaced in Block I. The book index is
 * primarily for navigation hints ("어느 챕터에 있어?"), not full content
 * reproduction. Sections inside each chapter are emitted by title only.
 */
export const MAX_BOOK_CHAPTERS = 8;

/** CP477+15 — Per-chapter section cap inside Block I. */
export const MAX_BOOK_SECTIONS_PER_CHAPTER = 6;

/** CP477+15 — Hard cap on Block N's note excerpt to keep prompt size bounded. */
export const MAX_NOTE_EXCERPT_CHARS = 1_500;

/** Activity window for recent_card_count_7d. */
export const RECENT_DAYS_WINDOW = 7;

/** Hard cap on transcript text length — mirrors the FE constant in ChatAssistant.tsx. */
export const TRANSCRIPT_PROMPT_MAX_CHARS = 20_000;
