/**
 * src/modules/chatbot-rag/prompt-builder.ts
 *
 * SSOT — Qwen-LoRA serving system prompt builder.
 *
 * Design: docs/design/insighta-chatbot-prompt-serving-design.md §3.
 * Mirror: scripts/lora-chatbot/convert-to-sft-v2.py (Python port — same
 * Block A~G + same layer→blocks mapping). 형식 변경 시 양쪽 동시 업데이트.
 *
 * Used by:
 *   - BE serving (qwen-lora mode):  /api/v1/chat/qwen route (TBD)
 *   - LoRA training data generator:  convert-to-sft-v2.py (Python mirror)
 *
 * CP474 extensions (inference-only, NOT in training data):
 *   - PRODUCT_PERSONA prepended (Insighta intro + glossary) — eliminates
 *     "Insighta = DAMO Academy" hallucination class.
 *   - Block U: per-user session context (tier / mandala list / activity).
 *   - Block T: raw transcript fallback when v2 rich summary is absent.
 *   - Block H: RAG retrieval results (cards / notes / KG concepts).
 *   - EXTENDED_RULES appended only when any of {U, T, H} present, so the
 *     original SFT-aligned ROLE_AND_RULES_KO/EN stays byte-identical.
 */
import type { UserContext, TranscriptContext, RAGContext, RAGResult } from './types';

// ============================================================================
// Types
// ============================================================================

export type ChatLayer = 'global' | 'mandala' | 'cell' | 'video' | 'video-time' | 'note';
export type Lang = 'ko' | 'en';

export interface KeyConcept {
  term: string;
  definition: string;
}

export interface MandalaFit {
  suggested_goals: string[];
  relevance_rationale: string;
}

export interface V2Section {
  idx: number;
  title: string;
  from_sec: number;
  to_sec: number;
  summary: string;
}

export interface V2Atom {
  idx: number;
  type: string;
  text: string;
  timestamp_sec: number;
}

export interface V2Core {
  one_liner?: string | null;
  domain?: string | null;
  depth_level?: string | null;
  content_type?: string | null;
  target_audience?: string | null;
}

export interface V2Analysis {
  core_argument?: string | null;
  key_concepts?: KeyConcept[] | null;
  actionables?: string[] | null;
  mandala_fit?: MandalaFit | null;
  prerequisites?: string | null;
}

export interface V2Segments {
  sections?: V2Section[] | null;
  atoms?: V2Atom[] | null;
}

export interface V2Summary {
  title?: string | null;
  core?: V2Core | null;
  analysis?: V2Analysis | null;
  segments?: V2Segments | null;
}

export interface MandalaContext {
  mandala_name: string;
  center_goal: string;
  cell_name?: string | null;
  cell_index?: number | null;
  relevance_rationale?: string | null;
}

export interface RegionContext {
  active_region: 'player' | 'notes' | 'sidebar' | 'book-index' | 'chat' | string;
  layer: ChatLayer | 'sidebar' | string;
  player_time_sec?: number | null;
  player_state?: 'playing' | 'paused' | 'ended' | string | null;
  current_section?: string | null;
  note_selection_text?: string | null;
}

// ============================================================================
// Constants — Role + Rules (§3.1, fixed)
// ============================================================================

export const ROLE_AND_RULES_KO = `[역할]
당신은 Insighta 학습 어시스턴트입니다. 사용자의 만다라 차트 목표와 시청 중인 영상을 기반으로 학습을 돕습니다.

[규칙]
- 영상 내용에 근거하여 답변. 불확실하면 "영상에서 다루지 않은 내용입니다" 답변
- 한국어 대화 기본. 사용자가 영어면 영어로 답변
- 보일러플레이트 문장 금지. 바로 핵심으로 시작
- 답변은 최대 3문장. 본질/핵심만. 배경 설명, 부연, 나열 금지
- 타임스탬프를 정확히 참조하여 근거 구간 표시 (예: (1:00-1:12))
- 영상 내용을 직접 발췌하듯 답변. 추상적 요약보다 구체적 팩트 우선`;

export const ROLE_AND_RULES_EN = `[Role]
You are Insighta's learning assistant. Help the user based on their mandala chart goals and the video they are watching.

[Rules]
- Ground answers in video content. If uncertain, reply "Not covered in this video".
- Default to Korean; reply in English when the user writes in English.
- No boilerplate. Start with the core insight directly.
- Maximum 3 sentences. Essence only — no background, padding, or enumeration.
- Cite exact timestamps as evidence (e.g., (1:00-1:12)).
- Quote the video; prefer concrete facts over abstract summary.`;

// ============================================================================
// Product persona + glossary (CP474 — NEW, prepended before role/rules)
//
// These two blocks eliminate the "Insighta = DAMO Academy" hallucination
// class observed during raw-curl LoRA testing. The model has no product
// docs in its SFT data — feeding the brief here grounds product Q&A.
// ============================================================================

export const PRODUCT_PERSONA_KO = `[Insighta 소개]
Insighta 는 YouTube 영상 기반 개인 지식 관리 플랫폼입니다. 핵심 구조:
- 9x9 만다라 차트로 학습 목표 체계화 (1 중심 목표 + 8 서브 목표 + 64 액션 cell = 총 81 cell)
- 사용자가 YouTube 영상을 만다라 cell 에 매핑하여 학습 진행
- AI 챗봇이 영상 내용 + 만다라 컨텍스트를 활용해 사용자 학습 지원
- 결제 tier: Free (3 만다라/150 카드) / Pro (20 만다라/1K 카드) / Lifetime (무제한)

[Insighta 용어 사전]
- 만다라 (Mandala): 사용자의 9x9 학습 목표 차트. 81개 cell 로 구성
- Center goal (중심 목표): 만다라 가운데 cell, 사용자의 최종 학습 목표
- Sub-goal (서브 목표): 중심 목표 주변 8개 cell, 1차 분해된 학습 영역
- Action cell (실행 cell): 각 sub-goal 의 8개 세부 액션, 영상이 매핑되는 단위
- Card (카드): 만다라 cell 에 매핑된 YouTube 영상 1개
- Wizard mode (위자드 모드): 만다라 자동 생성 도우미
- Learning page (학습 페이지): 영상 + 노트 + 챗봇 3-panel UI`;

export const PRODUCT_PERSONA_EN = `[About Insighta]
Insighta is a YouTube-based personal knowledge management platform. Core structure:
- 9x9 mandala chart to organize learning goals (1 center + 8 sub-goals + 64 action cells = 81 cells total)
- Users map YouTube videos to mandala cells to track learning progress
- AI chatbot leverages video content + mandala context to support learning
- Tiers: Free (3 mandalas / 150 cards) / Pro (20 / 1K) / Lifetime (unlimited)

[Insighta glossary]
- Mandala: a user's 9x9 learning goal chart (81 cells)
- Center goal: the chart's middle cell — the user's top-level learning objective
- Sub-goal: each of the 8 cells around the center — a 1st-level decomposition
- Action cell: 8 cells per sub-goal — granular learning actions; videos attach here
- Card: a YouTube video mapped to a mandala cell
- Wizard mode: assistant that auto-generates the initial mandala
- Learning page: 3-panel UI combining video, notes, and chatbot`;

// EXTENDED_RULES — appended only when any of Block {U, T, H} is present.
// Keeps the SFT-aligned ROLE_AND_RULES_KO/EN byte-identical for layers that
// don't use the CP474 extensions.
export const EXTENDED_RULES_KO = `[추가 규칙]
- Insighta 제품/기능 질문은 [Insighta 소개] 및 [용어 사전] 에 근거하여 답변
- [관련 자료 (RAG)] 가 있으면 적극 활용 — 출처 명시 (예: "당신이 학습한 X 영상에서도…", "당신의 노트(YYYY-MM-DD)에 따르면…")
- [영상 정보] 가 없고 [원본 자막] 만 있으면 자막에서 직접 발췌하여 답변 (추상 요약 X, 발화 인용)
- [영상 정보] 와 [원본 자막] 둘 다 없으면 "이 영상은 아직 분석되지 않았어요" 명시 후 일반 답변`;

export const EXTENDED_RULES_EN = `[Additional rules]
- Product/feature questions about Insighta MUST be grounded in [About Insighta] and [Insighta glossary] above.
- If [Related Materials (RAG)] is present, cite explicitly (e.g., "From the X video you watched…", "Your note (YYYY-MM-DD) states…").
- If only [Raw Transcript] is present (no [Video info]), quote the transcript directly instead of summarising.
- If neither [Video info] nor [Raw Transcript] is present, reply "This video hasn't been analysed yet" before answering generally.`;

// ============================================================================
// Layer → Blocks mapping (§3.3)
// ============================================================================

export type BlockId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'T' | 'U' | 'H';

/**
 * v2-grounded layer mapping (Block A-D come from V2Summary).
 * U (user) + H (RAG) are appended to every layer — they're orthogonal
 * to the chat surface the user is hovering over.
 */
export const LAYER_BLOCKS: Record<ChatLayer, BlockId[]> = {
  global: ['A', 'U', 'H'],
  mandala: ['A', 'E', 'U', 'H'],
  cell: ['A', 'B', 'C', 'E', 'U', 'H'],
  video: ['A', 'B', 'C', 'D', 'U', 'H'],
  'video-time': ['A', 'B', 'C', 'D', 'F', 'U', 'H'],
  note: ['A', 'B', 'C', 'D', 'F', 'G', 'U', 'H'],
};

/**
 * Transcript-fallback layer mapping (Block T replaces Block A-D when no
 * v2 rich summary exists for the current video). U/H remain available.
 */
export const LAYER_BLOCKS_FALLBACK: Record<ChatLayer, BlockId[]> = {
  global: ['T', 'U', 'H'],
  mandala: ['T', 'E', 'U', 'H'],
  cell: ['T', 'E', 'U', 'H'],
  video: ['T', 'U', 'H'],
  'video-time': ['T', 'F', 'U', 'H'],
  note: ['T', 'F', 'G', 'U', 'H'],
};

// ============================================================================
// Helpers
// ============================================================================

const KEY_CONCEPTS_MAX = 5;
const ACTIONABLES_MAX = 5;
const SECTIONS_MAX = 8;

function tsLabel(sec: number): string {
  const safe = Math.max(0, Math.floor(sec));
  const mm = Math.floor(safe / 60);
  const ss = safe % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

// ============================================================================
// Block builders (§3.2 A~G)
// ============================================================================

function blockA(v2: V2Summary, lang: Lang): string | null {
  const c = v2.core ?? {};
  const has = v2.title || c.one_liner || c.domain || c.target_audience || c.depth_level;
  if (!has) return null;
  if (lang === 'ko') {
    const lines = ['[영상 정보]'];
    if (v2.title) lines.push(`제목: ${v2.title}`);
    if (c.domain) lines.push(`도메인: ${c.domain}`);
    if (c.one_liner) lines.push(`핵심 주장: ${c.one_liner}`);
    if (c.target_audience) lines.push(`대상: ${c.target_audience}`);
    if (c.depth_level) lines.push(`난이도: ${c.depth_level}`);
    return lines.join('\n');
  }
  const lines = ['[Video info]'];
  if (v2.title) lines.push(`Title: ${v2.title}`);
  if (c.domain) lines.push(`Domain: ${c.domain}`);
  if (c.one_liner) lines.push(`Core: ${c.one_liner}`);
  if (c.target_audience) lines.push(`Audience: ${c.target_audience}`);
  if (c.depth_level) lines.push(`Depth: ${c.depth_level}`);
  return lines.join('\n');
}

function blockB(v2: V2Summary, lang: Lang): string | null {
  const kc = v2.analysis?.key_concepts ?? [];
  if (kc.length === 0) return null;
  const header = lang === 'ko' ? '[핵심 개념]' : '[Key concepts]';
  const items = kc.slice(0, KEY_CONCEPTS_MAX).map((c) => `- ${c.term}: ${c.definition}`);
  return [header, ...items].join('\n');
}

function blockC(v2: V2Summary, lang: Lang): string | null {
  const a = v2.analysis?.actionables ?? [];
  if (a.length === 0) return null;
  const header = lang === 'ko' ? '[실행 아이템]' : '[Action items]';
  const items = a.slice(0, ACTIONABLES_MAX).map((t) => `- ${t}`);
  return [header, ...items].join('\n');
}

function blockD(v2: V2Summary, lang: Lang): string | null {
  const s = v2.segments?.sections ?? [];
  if (s.length === 0) return null;
  const header = lang === 'ko' ? '[구간별 내용]' : '[Sections]';
  const unit = lang === 'ko' ? '초' : 's';
  const items = s
    .slice(0, SECTIONS_MAX)
    .map(
      (sec, i) => `${i + 1}. ${sec.title} (${sec.from_sec}~${sec.to_sec}${unit}): ${sec.summary}`
    );
  return [header, ...items].join('\n');
}

function blockE(m: MandalaContext, lang: Lang): string {
  if (lang === 'ko') {
    const lines = ['[만다라 컨텍스트]'];
    lines.push(`만다라: ${m.mandala_name}`);
    lines.push(`중심 목표: ${m.center_goal}`);
    if (m.cell_name) {
      const idx = m.cell_index != null ? ` (위치: ${m.cell_index})` : '';
      lines.push(`현재 셀: ${m.cell_name}${idx}`);
    }
    if (m.relevance_rationale) lines.push(`관련도: ${m.relevance_rationale}`);
    return lines.join('\n');
  }
  const lines = ['[Mandala context]'];
  lines.push(`Mandala: ${m.mandala_name}`);
  lines.push(`Center goal: ${m.center_goal}`);
  if (m.cell_name) {
    const idx = m.cell_index != null ? ` (cell: ${m.cell_index})` : '';
    lines.push(`Current cell: ${m.cell_name}${idx}`);
  }
  if (m.relevance_rationale) lines.push(`Relevance: ${m.relevance_rationale}`);
  return lines.join('\n');
}

function blockF(r: RegionContext, lang: Lang): string {
  if (lang === 'ko') {
    const lines = ['[현재 상태]'];
    lines.push(`활성 영역: ${r.active_region}`);
    lines.push(`레이어: ${r.layer}`);
    if (r.player_time_sec != null) lines.push(`재생 시각: ${tsLabel(r.player_time_sec)}`);
    if (r.player_state) lines.push(`플레이어 상태: ${r.player_state}`);
    if (r.current_section) lines.push(`현재 섹션: ${r.current_section}`);
    return lines.join('\n');
  }
  const lines = ['[Current state]'];
  lines.push(`Active region: ${r.active_region}`);
  lines.push(`Layer: ${r.layer}`);
  if (r.player_time_sec != null) lines.push(`Player time: ${tsLabel(r.player_time_sec)}`);
  if (r.player_state) lines.push(`Player state: ${r.player_state}`);
  if (r.current_section) lines.push(`Current section: ${r.current_section}`);
  return lines.join('\n');
}

function blockG(r: RegionContext, lang: Lang): string | null {
  if (!r.note_selection_text) return null;
  if (lang === 'ko') {
    return `[노트 컨텍스트]\n선택 텍스트: "${r.note_selection_text}"`;
  }
  return `[Note context]\nSelection: "${r.note_selection_text}"`;
}

// ============================================================================
// Block T — Transcript fallback (CP474 NEW)
//
// Emitted when no v2 rich summary exists. The transcript is already
// truncated to TRANSCRIPT_PROMPT_MAX_CHARS upstream (video-context-loader.ts).
// ============================================================================

function blockT(t: TranscriptContext, lang: Lang): string {
  if (lang === 'ko') {
    const header = '[원본 자막] (AI 요약 미생성, 자막 원본 활용)';
    const meta = `출처: ${t.source} / 언어: ${t.language}`;
    const note = t.truncated ? '\n\n[자막 일부 잘림 — 위 내용만 활용]' : '';
    return `${header}\n${meta}\n${t.full_text}${note}`;
  }
  const header = '[Raw Transcript] (no AI summary yet — quote captions directly)';
  const meta = `Source: ${t.source} / Language: ${t.language}`;
  const note = t.truncated ? '\n\n[Transcript truncated — use the above only]' : '';
  return `${header}\n${meta}\n${t.full_text}${note}`;
}

// ============================================================================
// Block U — User session context (CP474 NEW)
// ============================================================================

function blockU(u: UserContext, lang: Lang): string | null {
  // Defensive: blank user context (no tier signal, empty mandalas, no email)
  // → emit nothing rather than a near-empty block.
  if (!u.email && u.tier === 'free' && u.mandala_count === 0) {
    return null;
  }

  if (lang === 'ko') {
    const lines = ['[사용자 컨텍스트]'];
    lines.push(`사용자: ${u.display_name}${u.email ? ` (${u.email})` : ''}`);
    lines.push(`Tier: ${u.tier}`);
    if (u.join_date && u.days_active > 0) {
      lines.push(`가입일: ${u.join_date} (${u.days_active}일째 학습 중)`);
    }
    if (u.mandala_count > 0 && u.mandala_titles.length > 0) {
      const titles = u.mandala_titles.map((t) => `"${t}"`).join(', ');
      lines.push(`운영 중인 만다라: ${u.mandala_count}개 (${titles})`);
    }
    if (u.current_mandala_name) {
      lines.push(`현재 만다라: ${u.current_mandala_name}`);
    }
    if (u.recent_card_count_7d > 0) {
      lines.push(`이번 주 학습 카드: ${u.recent_card_count_7d}개`);
    }
    return lines.join('\n');
  }

  const lines = ['[User context]'];
  lines.push(`User: ${u.display_name}${u.email ? ` (${u.email})` : ''}`);
  lines.push(`Tier: ${u.tier}`);
  if (u.join_date && u.days_active > 0) {
    lines.push(`Joined: ${u.join_date} (${u.days_active} days learning)`);
  }
  if (u.mandala_count > 0 && u.mandala_titles.length > 0) {
    const titles = u.mandala_titles.map((t) => `"${t}"`).join(', ');
    lines.push(`Active mandalas: ${u.mandala_count} (${titles})`);
  }
  if (u.current_mandala_name) {
    lines.push(`Current mandala: ${u.current_mandala_name}`);
  }
  if (u.recent_card_count_7d > 0) {
    lines.push(`Cards added this week: ${u.recent_card_count_7d}`);
  }
  return lines.join('\n');
}

// ============================================================================
// Block H — RAG context (CP474 NEW)
// ============================================================================

function formatRAGResult(r: RAGResult, lang: Lang, index: number): string {
  if (lang === 'ko') {
    const lines: string[] = [];
    const label =
      r.source_type === 'card'
        ? '저장 카드'
        : r.source_type === 'note'
          ? '내 노트'
          : 'Knowledge Graph';
    const where =
      r.mandala_name && r.cell_name
        ? ` — ${r.mandala_name} / ${r.cell_name}`
        : r.mandala_name
          ? ` — ${r.mandala_name}`
          : '';
    lines.push(`${index + 1}. ${label}${where}: "${r.title}"`);
    if (r.excerpt) lines.push(`   ${r.excerpt}`);
    if (r.date) lines.push(`   (${r.date})`);
    if (r.kg_links && r.kg_links.length > 0) {
      const kg = r.kg_links.map((k) => `${k.concept} (${k.card_count} 카드)`).join(', ');
      lines.push(`   연결: ${kg}`);
    }
    return lines.join('\n');
  }
  const lines: string[] = [];
  const label =
    r.source_type === 'card'
      ? 'Saved card'
      : r.source_type === 'note'
        ? 'My note'
        : 'Knowledge Graph';
  const where =
    r.mandala_name && r.cell_name
      ? ` — ${r.mandala_name} / ${r.cell_name}`
      : r.mandala_name
        ? ` — ${r.mandala_name}`
        : '';
  lines.push(`${index + 1}. ${label}${where}: "${r.title}"`);
  if (r.excerpt) lines.push(`   ${r.excerpt}`);
  if (r.date) lines.push(`   (${r.date})`);
  if (r.kg_links && r.kg_links.length > 0) {
    const kg = r.kg_links.map((k) => `${k.concept} (${k.card_count} cards)`).join(', ');
    lines.push(`   Links: ${kg}`);
  }
  return lines.join('\n');
}

function blockH(rc: RAGContext, lang: Lang): string | null {
  if (!rc.results || rc.results.length === 0) return null;
  const header = lang === 'ko' ? '[관련 자료 (RAG)]' : '[Related Materials (RAG)]';
  const items = rc.results.map((r, i) => formatRAGResult(r, lang, i));
  return [header, ...items].join('\n\n');
}

// ============================================================================
// Main builder
// ============================================================================

export interface BuildQwenSystemPromptParams {
  layer: ChatLayer;
  language: Lang;
  v2Data?: V2Summary | null;
  mandalaContext?: MandalaContext | null;
  regionContext?: RegionContext | null;
  /** CP474 — per-user session context (Block U). */
  userContext?: UserContext | null;
  /** CP474 — transcript fallback (Block T). Used only when v2Data absent. */
  transcript?: TranscriptContext | null;
  /** CP474 — RAG retrieval results (Block H). */
  ragContext?: RAGContext | null;
  /**
   * CP474 — when false, omit PRODUCT_PERSONA / EXTENDED_RULES so the output
   * is byte-identical to the legacy SFT-aligned format (used by training-
   * data generation paths or A/B comparison). Default true (production).
   */
  includePersona?: boolean;
}

export function buildQwenSystemPrompt(params: BuildQwenSystemPromptParams): string {
  const {
    layer,
    language,
    v2Data,
    mandalaContext,
    regionContext,
    userContext,
    transcript,
    ragContext,
  } = params;
  const includePersona = params.includePersona ?? true;

  // Decide block set: v2 present → standard (A-D); else transcript exists
  // → fallback (T); else still walk the standard set and let each block
  // builder no-op when its source data is null.
  const useFallback = !v2Data && Boolean(transcript);
  const wanted = useFallback
    ? (LAYER_BLOCKS_FALLBACK[layer] ?? LAYER_BLOCKS_FALLBACK.global)
    : (LAYER_BLOCKS[layer] ?? LAYER_BLOCKS.global);

  const blocks: string[] = [];

  // Persona + glossary (CP474 — always first when enabled).
  if (includePersona) {
    blocks.push(language === 'ko' ? PRODUCT_PERSONA_KO : PRODUCT_PERSONA_EN);
  }

  // SFT-aligned role + rules (byte-identical to training data).
  blocks.push(language === 'ko' ? ROLE_AND_RULES_KO : ROLE_AND_RULES_EN);

  // Extended rules — only when any CP474 block is in play. Keeps legacy
  // layers free of training-data drift.
  const hasExtended =
    includePersona && (Boolean(userContext) || Boolean(transcript) || Boolean(ragContext));
  if (hasExtended) {
    blocks.push(language === 'ko' ? EXTENDED_RULES_KO : EXTENDED_RULES_EN);
  }

  const push = (b: string | null): void => {
    if (b) blocks.push(b);
  };

  for (const id of wanted) {
    switch (id) {
      case 'A':
        if (v2Data) push(blockA(v2Data, language));
        break;
      case 'B':
        if (v2Data) push(blockB(v2Data, language));
        break;
      case 'C':
        if (v2Data) push(blockC(v2Data, language));
        break;
      case 'D':
        if (v2Data) push(blockD(v2Data, language));
        break;
      case 'E':
        if (mandalaContext) push(blockE(mandalaContext, language));
        break;
      case 'F':
        if (regionContext) push(blockF(regionContext, language));
        break;
      case 'G':
        if (regionContext) push(blockG(regionContext, language));
        break;
      case 'T':
        if (transcript) push(blockT(transcript, language));
        break;
      case 'U':
        if (userContext) push(blockU(userContext, language));
        break;
      case 'H':
        if (ragContext) push(blockH(ragContext, language));
        break;
    }
  }

  return blocks.join('\n\n');
}

// ============================================================================
// Training-data helper: map (level, context, region.layer) → ChatLayer
//
// Used by convert-to-sft-v2.py (mirror this logic in Python).
// ============================================================================

export function deriveTrainingLayer(input: {
  level: 1 | 2 | 3 | 4;
  context: string;
  regionLayer?: string | null;
}): ChatLayer {
  const { level, context, regionLayer } = input;

  // Explicit region.layer wins (L4 entries from generate-l4-qa.ts)
  if (regionLayer) {
    if (regionLayer === 'video-time') return 'video-time';
    if (regionLayer === 'note') return 'note';
    if (regionLayer === 'cell') return 'cell';
    if (regionLayer === 'mandala') return 'mandala';
    if (regionLayer === 'sidebar') return 'video'; // sidebar = generic video browsing
  }

  // Fallback by level + context
  if (level === 1) return 'video';
  if (level === 2) return 'cell';
  if (level === 3) return 'mandala';
  if (context === 'mandala_cell') return 'cell';
  if (context === 'mandala_mesh') return 'mandala';
  return 'global';
}
