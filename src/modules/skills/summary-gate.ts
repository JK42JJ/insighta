/**
 * SummaryQualityGate — Rule-based quality validation for rich summaries
 *
 * Supports both v1 and v2 schemas via separate check functions.
 * Interface contract (stable across phases):
 *   check(summary) → { score, passed, action, reasons }
 *
 * Design: docs/design/skill-registry-handoff.md
 * Issue: #337 (Step 3), #497 (CoT detection), #501 (v2 gate)
 */

import { isV2Summary } from './rich-summary-types';
import type { GateResult, RichSummary, RichSummaryV1, RichSummaryV2 } from './rich-summary-types';

export type { GateResult, RichSummary, RichSummaryV1, RichSummaryV2 };
export { isV2Summary };

// ============================================================================
// Constants
// ============================================================================

const PASS_THRESHOLD = 0.7;

const HALLUCINATION_PATTERNS = [
  /as an ai/i,
  /i don't know/i,
  /i cannot/i,
  /죄송합니다/,
  /(.)\1{5,}/,
];

const COT_LEAKAGE_PATTERNS = [
  /<think>/i,
  /<\/think>/i,
  /\blet me (start|think|analyze|consider|break)/i,
  /\b(okay|ok),?\s+(so|i|let|now|the)\b/i,
  /\bwait,?\s+(the|i|let|but|actually)\b/i,
  /\bfirst,?\s+i('ll| will| need| should)\b/i,
  /\bhmm+\b/i,
  /\bstep \d+:/i,
  /\bnow,?\s+(let|i)\b/i,
  /\bthe user (wants|asked|is asking)/i,
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
  if (isV2Summary(summary)) {
    return checkV2SummaryQuality(summary);
  }
  return checkV1SummaryQuality(summary);
}

function checkV1SummaryQuality(summary: RichSummaryV1): GateResult {
  let score = 0;
  const reasons: string[] = [];

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

  const fullText = JSON.stringify(summary);
  const hasHallucination = HALLUCINATION_PATTERNS.some((pattern) => pattern.test(fullText));
  const hasCoTLeakage = COT_LEAKAGE_PATTERNS.some((pattern) => pattern.test(fullText));
  if (!hasHallucination && !hasCoTLeakage) {
    score += WEIGHT.NO_HALLUCINATION;
  } else {
    if (hasHallucination) reasons.push('hallucination pattern detected');
    if (hasCoTLeakage) reasons.push('CoT leakage detected — reasoning text in summary');
  }

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

  score = Math.round(score * 100) / 100;
  const passed = score >= PASS_THRESHOLD;
  return { score, passed, action: passed ? 'use' : 'retry', reasons };
}

// ============================================================================
// v2 Quality Gate — entities/atoms/sections validation (#501)
// ============================================================================

const V2_WEIGHT = {
  CORE_ARGUMENT: 0.1,
  ENTITIES: 0.15,
  ATOMS: 0.1,
  SECTIONS: 0.15,
  NO_HALLUCINATION: 0.25,
  BIAS_SIGNALS: 0.1,
  META: 0.05,
  TL_DR: 0.1,
} as const;

const VALID_ENTITY_TYPES = new Set(['concept', 'person', 'tool', 'framework', 'organization']);

function checkV2SummaryQuality(summary: RichSummaryV2): GateResult {
  let score = 0;
  const reasons: string[] = [];

  const core = summary.core_argument ?? '';
  if (core.length >= 10 && core.length <= 150) {
    score += V2_WEIGHT.CORE_ARGUMENT;
  } else {
    reasons.push(`core_argument length issue: ${core.length} chars (expected 10-150)`);
  }

  const entities = summary.entities ?? [];
  if (entities.length >= 2) {
    const allValid = entities.every((e) => e.name && VALID_ENTITY_TYPES.has(e.type));
    if (allValid) {
      score += V2_WEIGHT.ENTITIES;
    } else {
      score += V2_WEIGHT.ENTITIES * 0.5;
      reasons.push('some entities have invalid type or empty name');
    }
  } else {
    reasons.push(`entities insufficient: ${entities.length} (expected 2+)`);
  }

  const atoms = summary.atoms ?? [];
  if (atoms.length >= 2) {
    score += V2_WEIGHT.ATOMS;
  } else {
    reasons.push(`atoms insufficient: ${atoms.length} (expected 2+)`);
  }

  const sections = summary.sections ?? [];
  if (sections.length >= 2) {
    const hasTimestamps = sections.every(
      (s) => typeof s.from_sec === 'number' && typeof s.to_sec === 'number'
    );
    const hasRelevance = sections.every(
      (s) => typeof s.relevance_pct === 'number' && s.relevance_pct >= 0 && s.relevance_pct <= 100
    );
    if (hasTimestamps && hasRelevance) {
      score += V2_WEIGHT.SECTIONS;
    } else {
      score += V2_WEIGHT.SECTIONS * 0.5;
      if (!hasTimestamps) reasons.push('sections missing valid timestamps');
      if (!hasRelevance) reasons.push('sections missing valid relevance_pct (0-100)');
    }
  } else {
    reasons.push(`sections insufficient: ${sections.length} (expected 2+)`);
  }

  const fullText = JSON.stringify(summary);
  const hasHallucination = HALLUCINATION_PATTERNS.some((p) => p.test(fullText));
  const hasCoTLeakage = COT_LEAKAGE_PATTERNS.some((p) => p.test(fullText));
  if (!hasHallucination && !hasCoTLeakage) {
    score += V2_WEIGHT.NO_HALLUCINATION;
  } else {
    if (hasHallucination) reasons.push('hallucination pattern detected');
    if (hasCoTLeakage) reasons.push('CoT leakage detected — reasoning text in summary');
  }

  if (Array.isArray(summary.bias_signals)) {
    score += V2_WEIGHT.BIAS_SIGNALS;
  } else {
    reasons.push('bias_signals not parseable as array');
  }

  if (
    VALID_CONTENT_TYPES.has(summary.content_type) &&
    VALID_DEPTH_LEVELS.has(summary.depth_level)
  ) {
    score += V2_WEIGHT.META;
  }

  const hasTlDr = (summary.tl_dr_ko?.length ?? 0) >= 10 && (summary.tl_dr_en?.length ?? 0) >= 10;
  if (hasTlDr) {
    score += V2_WEIGHT.TL_DR;
  } else {
    reasons.push('tl_dr_ko or tl_dr_en too short (expected 10+ chars each)');
  }

  score = Math.round(score * 100) / 100;
  const passed = score >= PASS_THRESHOLD;
  return { score, passed, action: passed ? 'use' : 'retry', reasons };
}
