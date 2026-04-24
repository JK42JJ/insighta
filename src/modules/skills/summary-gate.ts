/**
 * SummaryQualityGate — Rule-based quality validation for rich summaries
 *
 * Phase 1: TypeScript rule-based scoring (string length, regex, field validation)
 * Phase 2: Python Sidecar ML-based scoring (BGE-M3, ONNX, HuggingFace)
 *
 * Interface contract (stable across phases):
 *   check(summary) → { score, passed, action, reasons }
 *
 * Migration path: When Python Sidecar is ready, swap this implementation
 * for an HTTP call to the sidecar. The GateResult interface stays the same.
 *
 * Design: docs/design/skill-registry-handoff.md
 * Issue: #337 (Step 3)
 */

// ============================================================================
// Types
// ============================================================================

export interface GateResult {
  /** Quality score 0.0 ~ 1.0 */
  score: number;
  /** Whether the summary passes the quality threshold */
  passed: boolean;
  /** Recommended action: 'use' | 'retry' | 'fallback' */
  action: 'use' | 'retry' | 'fallback';
  /** Human-readable reasons for score deductions */
  reasons: string[];
}

export interface RichSummaryChapter {
  start_sec: number;
  title: string;
}

export interface RichSummaryQuote {
  timestamp_sec: number;
  text: string;
}

export interface RichSummary {
  core_argument?: string;
  key_points?: string[];
  evidence?: string[];
  actionables?: string[];
  prerequisites?: string[];
  bias_signals?: string[];
  content_type?: string;
  depth_level?: string;
  mandala_fit?: {
    suggested_topics?: string[];
    relevance_rationale?: string;
  };
  // --- CP422 P1 additions (optional; empty when caption source unavailable) ---
  chapters?: RichSummaryChapter[];
  quotes?: RichSummaryQuote[];
  tl_dr_ko?: string;
  tl_dr_en?: string;
}

// ============================================================================
// Constants
// ============================================================================

const PASS_THRESHOLD = 0.7;

const HALLUCINATION_PATTERNS = [
  /as an ai/i,
  /i don't know/i,
  /i cannot/i,
  /죄송합니다/,
  /(.)\1{5,}/, // 5+ repeated characters
];

const VALID_CONTENT_TYPES = new Set(['tutorial', 'opinion', 'research', 'news', 'entertainment']);

const VALID_DEPTH_LEVELS = new Set(['beginner', 'intermediate', 'advanced']);

// ============================================================================
// Score weights
// ============================================================================

const WEIGHT = {
  CORE_ARGUMENT: 0.15,
  KEY_POINTS: 0.15,
  ACTIONABLES: 0.1,
  NO_HALLUCINATION: 0.3,
  BIAS_SIGNALS: 0.2,
  CONTENT_TYPE: 0.05,
  DEPTH_LEVEL: 0.05,
} as const;

// ============================================================================
// Implementation — Phase 1: Rule-based
// ============================================================================

/**
 * Validate a rich summary's quality using rule-based scoring.
 *
 * Scoring breakdown (total 1.0):
 * - Structure (0.40): core_argument length + key_points count + actionables presence
 * - Hallucination (0.30): regex pattern detection
 * - Meta fields (0.30): bias_signals parseable + content_type + depth_level valid
 */
export function checkSummaryQuality(summary: RichSummary): GateResult {
  let score = 0;
  const reasons: string[] = [];

  // 1. Structure checks (0.40)
  const core = summary.core_argument ?? '';
  if (core.length >= 10 && core.length <= 100) {
    score += WEIGHT.CORE_ARGUMENT;
  } else {
    reasons.push(`core_argument length issue: ${core.length} chars (expected 10-100)`);
  }

  const keyPoints = summary.key_points ?? [];
  if (Array.isArray(keyPoints) && keyPoints.length >= 3) {
    score += WEIGHT.KEY_POINTS;
  } else {
    reasons.push(`key_points insufficient: ${keyPoints.length} items (expected 3+)`);
  }

  if (summary.actionables && summary.actionables.length > 0) {
    score += WEIGHT.ACTIONABLES;
  } else {
    reasons.push('actionables missing or empty');
  }

  // 2. Hallucination check (0.30)
  const fullText = JSON.stringify(summary).toLowerCase();
  const hasHallucination = HALLUCINATION_PATTERNS.some((pattern) => pattern.test(fullText));
  if (!hasHallucination) {
    score += WEIGHT.NO_HALLUCINATION;
  } else {
    reasons.push('hallucination pattern detected');
  }

  // 3. Meta field checks (0.30)
  if (Array.isArray(summary.bias_signals)) {
    score += WEIGHT.BIAS_SIGNALS;
  } else {
    reasons.push('bias_signals not parseable as array');
  }

  if (summary.content_type && VALID_CONTENT_TYPES.has(summary.content_type)) {
    score += WEIGHT.CONTENT_TYPE;
  }

  if (summary.depth_level && VALID_DEPTH_LEVELS.has(summary.depth_level)) {
    score += WEIGHT.DEPTH_LEVEL;
  }

  // Round to 2 decimal places
  score = Math.round(score * 100) / 100;

  const passed = score >= PASS_THRESHOLD;
  const action = passed ? 'use' : 'retry';

  return { score, passed, action, reasons };
}
