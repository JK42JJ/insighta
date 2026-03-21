import { z } from 'zod';

// ============================================================================
// Per-type JSONB property validation schemas
// ADR-1: Zod per-type validation compensates for generic JSONB column
// ============================================================================

export const RESOURCE_PROPERTIES = z.object({
  url: z.string().url().optional(),
  link_type: z.string().optional(),
  thumbnail: z.string().optional(),
  user_note: z.string().optional(),
  summary: z.string().optional(),
  summary_en: z.string().optional(),
  summary_ko: z.string().optional(),
  summary_tags: z.array(z.string()).optional(),
  summary_model: z.string().optional(),
  summary_created_at: z.string().optional(),
  summary_rating: z
    .union([z.literal(1), z.literal(-1)])
    .nullable()
    .optional(),
  summary_rated_at: z.string().optional(),
  summary_dismissed: z.boolean().optional(),
});

export const INSIGHT_PROPERTIES = z.object({
  confidence: z.number().min(0).max(1).optional(),
  source_node_ids: z.array(z.string().uuid()).optional(),
});

export const MANDALA_PROPERTIES = z.object({
  is_default: z.boolean().optional(),
  position: z.number().int().optional(),
});

export const MANDALA_SECTOR_PROPERTIES = z.object({
  level_key: z.string().optional(),
  center_goal: z.string().optional(),
  subjects: z.array(z.string()).optional(),
  position: z.number().int().optional(),
  depth: z.number().int().optional(),
});

export const GOAL_PROPERTIES = z.object({
  description: z.string().optional(),
});

export const TOPIC_PROPERTIES = z.object({
  description: z.string().optional(),
});

export const NOTE_PROPERTIES = z.object({
  content: z.string().optional(),
  video_timestamp: z.number().optional(),
});

export const SOURCE_PROPERTIES = z.object({
  youtube_video_id: z.string().optional(),
  channel_title: z.string().optional(),
  thumbnail_url: z.string().optional(),
  duration_seconds: z.number().int().optional(),
});

export const SOURCE_SEGMENT_PROPERTIES = z.object({
  start_time: z.number().optional(),
  end_time: z.number().optional(),
  text: z.string().optional(),
});

export const PATTERN_PROPERTIES = z.object({
  description: z.string().optional(),
  recurrence: z.number().int().optional(),
});

export const DECISION_PROPERTIES = z.object({
  rationale: z.string().optional(),
  status: z.enum(['proposed', 'accepted', 'deprecated']).optional(),
});

export const PROBLEM_PROPERTIES = z.object({
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  status: z.enum(['open', 'resolved', 'wont_fix']).optional(),
});

// Fallback for unknown types
const GENERIC_PROPERTIES = z.record(z.unknown());

export const PROPERTIES_BY_TYPE: Record<string, z.ZodSchema> = {
  resource: RESOURCE_PROPERTIES,
  insight: INSIGHT_PROPERTIES,
  mandala: MANDALA_PROPERTIES,
  mandala_sector: MANDALA_SECTOR_PROPERTIES,
  goal: GOAL_PROPERTIES,
  topic: TOPIC_PROPERTIES,
  note: NOTE_PROPERTIES,
  source: SOURCE_PROPERTIES,
  source_segment: SOURCE_SEGMENT_PROPERTIES,
  pattern: PATTERN_PROPERTIES,
  decision: DECISION_PROPERTIES,
  problem: PROBLEM_PROPERTIES,
};

export function validateProperties(
  type: string,
  properties: unknown
): z.SafeParseReturnType<unknown, unknown> {
  const schema = PROPERTIES_BY_TYPE[type] ?? GENERIC_PROPERTIES;
  return schema.safeParse(properties);
}
