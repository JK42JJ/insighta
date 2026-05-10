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
 */

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
// Layer → Blocks mapping (§3.3)
// ============================================================================

export type BlockId = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';

export const LAYER_BLOCKS: Record<ChatLayer, BlockId[]> = {
  global: ['A'],
  mandala: ['A', 'E'],
  cell: ['A', 'B', 'C', 'E'],
  video: ['A', 'B', 'C', 'D'],
  'video-time': ['A', 'B', 'C', 'D', 'F'],
  note: ['A', 'B', 'C', 'D', 'F', 'G'],
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
// Main builder
// ============================================================================

export interface BuildQwenSystemPromptParams {
  layer: ChatLayer;
  language: Lang;
  v2Data?: V2Summary | null;
  mandalaContext?: MandalaContext | null;
  regionContext?: RegionContext | null;
}

export function buildQwenSystemPrompt(params: BuildQwenSystemPromptParams): string {
  const { layer, language, v2Data, mandalaContext, regionContext } = params;

  const wanted = LAYER_BLOCKS[layer] ?? LAYER_BLOCKS.global;
  const blocks: string[] = [language === 'ko' ? ROLE_AND_RULES_KO : ROLE_AND_RULES_EN];

  const push = (b: string | null) => {
    if (b) blocks.push(b);
  };

  if (wanted.includes('A') && v2Data) push(blockA(v2Data, language));
  if (wanted.includes('B') && v2Data) push(blockB(v2Data, language));
  if (wanted.includes('C') && v2Data) push(blockC(v2Data, language));
  if (wanted.includes('D') && v2Data) push(blockD(v2Data, language));
  if (wanted.includes('E') && mandalaContext) push(blockE(mandalaContext, language));
  if (wanted.includes('F') && regionContext) push(blockF(regionContext, language));
  if (wanted.includes('G') && regionContext) push(blockG(regionContext, language));

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
