/**
 * Rich Summary v2 Type Definitions
 *
 * v2 schema serves three consumers:
 * 1. KG Bridge: entities[] → topic nodes, atoms[] → insight nodes
 * 2. Learning Interface: sections[] → section-by-section analysis with timestamps
 * 3. Quality Gate: structured validation of all fields
 *
 * Issue: #499
 */

// ============================================================================
// v2 Schema — KG Bridge types
// ============================================================================

export interface RichSummaryEntity {
  name: string;
  type: 'concept' | 'person' | 'tool' | 'framework' | 'organization';
}

export interface RichSummaryAtom {
  text: string;
  timestamp_sec?: number;
  entity_refs?: string[];
}

// ============================================================================
// v2 Schema — Learning Interface types
// ============================================================================

export interface RichSummarySectionKeyPoint {
  text: string;
  timestamp_sec?: number;
}

export interface RichSummarySection {
  from_sec: number;
  to_sec: number;
  title: string;
  summary: string;
  relevance_pct: number;
  key_points: RichSummarySectionKeyPoint[];
}

// ============================================================================
// v2 Schema — Full structure
// ============================================================================

export interface RichSummaryV2 {
  core_argument: string;

  entities: RichSummaryEntity[];
  atoms: RichSummaryAtom[];
  sections: RichSummarySection[];

  actionables: string[];
  prerequisites: string[];
  bias_signals: string[];

  content_type: 'tutorial' | 'opinion' | 'research' | 'news' | 'entertainment';
  depth_level: 'beginner' | 'intermediate' | 'advanced';

  mandala_fit: {
    suggested_topics: string[];
    relevance_rationale: string;
  };

  tl_dr_ko: string;
  tl_dr_en: string;
}

// ============================================================================
// v1 Schema (legacy — kept for backward compatibility)
// ============================================================================

export interface RichSummaryChapter {
  start_sec: number;
  title: string;
}

export interface RichSummaryQuote {
  timestamp_sec: number;
  text: string;
}

export interface RichSummaryV1 {
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
  chapters?: RichSummaryChapter[];
  quotes?: RichSummaryQuote[];
  tl_dr_ko?: string;
  tl_dr_en?: string;
}

export type RichSummary = RichSummaryV1 | RichSummaryV2;

// ============================================================================
// Type guards
// ============================================================================

export function isV2Summary(s: RichSummary): s is RichSummaryV2 {
  return (
    Array.isArray((s as RichSummaryV2).entities) && Array.isArray((s as RichSummaryV2).sections)
  );
}

// ============================================================================
// Gate result (shared by v1 and v2 gates)
// ============================================================================

export interface GateResult {
  score: number;
  passed: boolean;
  action: 'use' | 'retry' | 'fallback';
  reasons: string[];
}
