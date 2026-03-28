/**
 * Skill System — Type Definitions
 *
 * Core interfaces for the SkillRegistry pattern.
 * Skills are automated actions (newsletter, report, alert, recommend)
 * that operate on top of Insighta's knowledge graph.
 *
 * Design: docs/design/skill-registry-handoff.md
 * Policy: docs/policies/skill-quota-policy.md
 * Issue: #337 (Step 2)
 */

import type { JSONSchema7 } from 'json-schema';
import type { GenerationProvider } from '@/modules/llm/provider';
import type { Tier } from '@/config/quota';

export interface SkillContext {
  userId: string;
  mandalaId: string;
  tier: Tier;
  /** LLM provider — user key takes priority, falls back to Insighta default */
  llm: GenerationProvider;
  /** Per-skill additional parameters */
  params?: Record<string, unknown>;
}

export interface SkillResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  metadata?: {
    duration_ms: number;
    llm_tokens_used?: number;
  };
}

export interface SkillPreview {
  subject?: string;
  preview_html?: string;
  curated_count?: number;
}

export type SkillTrigger =
  | { type: 'cron'; schedule: string }
  | { type: 'event'; event: string }
  | { type: 'manual' };

export interface InsightaSkill {
  id: string;
  version: string;
  description: string;
  trigger: SkillTrigger;
  tiers: readonly Tier[];

  /**
   * JSON Schema 7 format — identical to Claude Tool Use input_schema.
   * Can be serialized as MCP tools[] without conversion.
   */
  inputSchema: JSONSchema7;

  execute(ctx: SkillContext): Promise<SkillResult>;
  dryRun(ctx: SkillContext): Promise<SkillPreview>;
}
