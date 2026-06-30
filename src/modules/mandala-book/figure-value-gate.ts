// Figure value gate — drops generic illustrations before attaching to book sections.
//
// A figure must ADD information the section text lacks. Generic metaphors or diagrams
// that merely restate the prose are "어거지 삽화" (forced filler) with zero info increment.
// Policy per kind:
//   equation → KEEP always (formula = portable info, always additive).
//   chart    → KEEP (renderFigureSvg non-null already proves non-flat variance).
//   table    → KEEP if struct.headers + ≥2 rows.
//   diagram  → Haiku judge: specific structure NOT stated in section text? KEEP else DROP.
//              Conservative default: DROP on uncertainty / parse failure.
//
// Service module — the Haiku call is a PRODUCTION call via OpenRouter.
// Unit tests MUST mock OpenRouterGenerationProvider (LLM-API ban).

import { OpenRouterGenerationProvider } from '@/modules/llm/openrouter';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'mandala-book/figure-value-gate' });

const HAIKU_MODEL = 'anthropic/claude-haiku-4.5';
const DIAGRAM_JUDGE_MAX_TOKENS = 256;
const DIAGRAM_JUDGE_TEMPERATURE = 0.1;

// Max chars of section narrative sent to diagram judge (cost control).
const NARRATIVE_EXCERPT_LEN = 300;
// Max nodes/edges shown in diagram struct summary (cost control).
const STRUCT_NODE_CAP = 10;
const STRUCT_EDGE_CAP = 10;

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Strict output expected from the Haiku diagram judge. */
export interface DiagramJudgeResult {
  keep: boolean;
  reason: string;
}

// ---------------------------------------------------------------------------
// Struct summariser (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Produce a compact text representation of a diagram struct for inclusion in
 * the judge prompt. Handles common graph-like shapes (nodes[]/edges[]) and
 * falls back to a JSON snippet for unknown shapes.
 */
export function summarizeDiagramStruct(struct: Record<string, unknown>): string {
  const nodeList = Array.isArray(struct['nodes']) ? (struct['nodes'] as unknown[]) : null;
  const edgeList = Array.isArray(struct['edges']) ? (struct['edges'] as unknown[]) : null;

  const parts: string[] = [];

  if (nodeList) {
    const labels = nodeList.slice(0, STRUCT_NODE_CAP).map((n) => {
      if (typeof n === 'object' && n !== null) {
        const obj = n as Record<string, unknown>;
        return String(obj['label'] ?? obj['id'] ?? obj['name'] ?? '?');
      }
      return String(n);
    });
    parts.push(`nodes: [${labels.join(', ')}]`);
  }

  if (edgeList) {
    const arrows = edgeList.slice(0, STRUCT_EDGE_CAP).map((e) => {
      if (typeof e === 'object' && e !== null) {
        const obj = e as Record<string, unknown>;
        const src = String(obj['from'] ?? obj['source'] ?? obj['src'] ?? '?');
        const dst = String(obj['to'] ?? obj['target'] ?? obj['dst'] ?? '?');
        return `${src}→${dst}`;
      }
      return String(e);
    });
    parts.push(`edges: [${arrows.join(', ')}]`);
  }

  if (parts.length > 0) return parts.join('; ');

  // Fallback: truncated JSON for unknown struct shapes.
  return JSON.stringify(struct).slice(0, 200);
}

// ---------------------------------------------------------------------------
// Diagram judge prompt (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Build the Haiku prompt for the diagram value judge.
 * Ask: does the diagram add SPECIFIC structure the section text already fully conveys?
 */
export function buildDiagramJudgePrompt(
  structSummary: string,
  sectionTitle: string,
  sectionNarrative: string
): string {
  const excerpt = sectionNarrative.slice(0, NARRATIVE_EXCERPT_LEN);
  return [
    'You judge whether a diagram adds information not already stated in the section text.',
    '',
    `Section title: ${sectionTitle}`,
    `Section text (excerpt): ${excerpt}`,
    '',
    `Diagram structure: ${structSummary}`,
    '',
    'Question: Does this diagram convey a SPECIFIC structure or relationship that is NOT',
    'already fully stated in the section text? If the diagram merely illustrates what the',
    'text already says in full, it is a generic filler and should be DROPPED.',
    '',
    'DROP examples: "neurons connecting" sketch for a neural-network intro section,',
    '"boxer 120kg→60kg" metaphor for a weight-loss analogy, "chip→cloud" arrow restating',
    '"edge computing" already described in prose.',
    'KEEP examples: transformer attention-head matrix with specific layer names,',
    'TCP three-way handshake state machine with state labels, backprop gradient flow',
    'annotated with weight dimensions.',
    '',
    'Return JSON only (no code fence, no extra text):',
    '{"keep": true|false, "reason": "one sentence"}',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Judge response parser (exported for tests)
// ---------------------------------------------------------------------------

/**
 * Parse Haiku judge raw output into DiagramJudgeResult.
 * Conservative: any parse/shape failure returns keep=false.
 */
export function parseJudgeResponse(raw: string): DiagramJudgeResult {
  const stripped = raw
    .trim()
    .replace(/^\s*```(?:json)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '')
    .trim();

  try {
    const parsed = JSON.parse(stripped) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>)['keep'] === 'boolean'
    ) {
      const obj = parsed as Record<string, unknown>;
      return {
        keep: obj['keep'] as boolean,
        reason: typeof obj['reason'] === 'string' ? obj['reason'] : '',
      };
    }
  } catch {
    // JSON parse failure → conservative drop
  }

  return { keep: false, reason: 'parse-failure: conservative drop' };
}

// ---------------------------------------------------------------------------
// Diagram judge (exported for tests + handler)
// ---------------------------------------------------------------------------

/**
 * Judge a diagram figure via Haiku: does it add specific structure the section text lacks?
 * Conservative default: DROP on LLM error, timeout, or parse failure.
 */
export async function judgeDiagram(
  struct: Record<string, unknown> | undefined,
  sectionTitle: string,
  sectionNarrative: string
): Promise<DiagramJudgeResult> {
  if (!struct) {
    return { keep: false, reason: 'no-struct: conservative drop' };
  }

  const structSummary = summarizeDiagramStruct(struct);
  const prompt = buildDiagramJudgePrompt(structSummary, sectionTitle, sectionNarrative);

  let raw: string;
  try {
    raw = await new OpenRouterGenerationProvider(HAIKU_MODEL).generate(prompt, {
      format: 'json',
      temperature: DIAGRAM_JUDGE_TEMPERATURE,
      maxTokens: DIAGRAM_JUDGE_MAX_TOKENS,
    });
  } catch (err) {
    log.warn('figure-value-gate: diagram judge LLM 호출 실패 → DROP', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { keep: false, reason: 'llm-error: conservative drop' };
  }

  const result = parseJudgeResponse(raw);
  log.debug('figure-value-gate: diagram judge 결과', {
    keep: result.keep,
    reason: result.reason,
  });
  return result;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Options for passesFigureValueGate. */
export interface FigureValueGateOpts {
  kind: string;
  /** struct narrowed from FigureRef.struct (null/undefined when absent). */
  struct: Record<string, unknown> | undefined;
  /** Title of the section the figure would attach to (for diagram judge). */
  sectionTitle: string;
  /** Narrative body of the section (for diagram judge). */
  sectionNarrative: string;
}

/**
 * Value gate: decide whether to attach a figure to a section.
 * Returns true → KEEP (attach); false → DROP.
 *
 * equation  — always KEEP.
 * chart     — always KEEP (SVG presence already proved non-flat variance).
 * table     — KEEP if struct has headers[] + ≥2 rows[].
 * diagram   — Haiku judge per (struct, section); DROP on uncertainty (conservative).
 * other     — DROP (unknown kinds are not information-bearing by policy).
 *
 * Never throws — all errors default to DROP.
 */
export async function passesFigureValueGate(opts: FigureValueGateOpts): Promise<boolean> {
  const { kind, struct, sectionTitle, sectionNarrative } = opts;

  switch (kind) {
    case 'equation':
      // Equations are always information-bearing: formula is portable + non-redundant.
      return true;

    case 'chart':
      // renderFigureSvg non-null already proved non-flat data variance (slidegen gate).
      return true;

    case 'table': {
      if (!struct) return false;
      const hasHeaders =
        Array.isArray(struct['headers']) && (struct['headers'] as unknown[]).length > 0;
      const hasRows = Array.isArray(struct['rows']) && (struct['rows'] as unknown[]).length >= 2;
      return hasHeaders && hasRows;
    }

    case 'diagram': {
      const result = await judgeDiagram(struct, sectionTitle, sectionNarrative);
      return result.keep;
    }

    default:
      // Unknown kinds are not information-bearing by policy.
      return false;
  }
}
