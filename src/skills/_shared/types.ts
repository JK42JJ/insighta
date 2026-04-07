/**
 * Skill Plugin — Shared Types
 *
 * Plugin-side type definitions for the new SkillManifest + SkillExecutor
 * 3-stage architecture (preflight → execute → deliver).
 *
 * Authoritative spec: docs/design/insighta-skill-plugin-architecture.md
 *
 * These types live in `_shared/` because they are the *contract* every plugin
 * under `src/skills/plugins/{id}/` consumes. They are intentionally kept
 * isolated from the legacy flat-skill types in `src/modules/skills/types.ts`
 * (which the registry-adapter wraps).
 *
 * Phase: 1 (CP352, #358 → #366)
 */

import type { JSONSchema7 } from 'json-schema';
import type { GenerationProvider } from '@/modules/llm/provider';
import type { Tier } from '@/config/quota';

// ============================================================================
// Manifest
// ============================================================================

export type SkillLayer = 'A' | 'B' | 'C';

export type SkillEventName =
  | 'mandala.created'
  | 'mandala.updated'
  | 'card.added'
  | 'dashboard.viewed'
  | 'weights.proposed'
  | 'admin.approved';

export type SkillTrigger =
  | { type: 'manual' }
  | { type: 'cron'; schedule: string }
  | { type: 'event'; event: SkillEventName };

export interface SkillTableAccess {
  /** Tables this skill is allowed to READ. */
  read: readonly string[];
  /** Tables this skill is allowed to WRITE (INSERT/UPDATE/UPSERT/DELETE). */
  write: readonly string[];
}

export interface SkillExternalDependency {
  /** Symbolic name (matches credentials.md row). */
  name: string;
  /** Required env var key. Missing → preflight fails. */
  env: string;
  /** True if the skill cannot run at all without this. False = degraded mode OK. */
  required: boolean;
}

export interface SkillManifest {
  /** Stable kebab-case identifier, used for routing + skill_runs.skill_id. */
  id: string;
  /** semver, e.g. '1.0.0' or '0.1.0-beta'. */
  version: string;
  /** One-line, user-visible description. */
  description: string;
  /** A | B | C — see plugin architecture doc §2. */
  layer: SkillLayer;
  trigger: SkillTrigger;
  /** Tiers allowed to invoke this skill. */
  tiers: readonly Tier[];
  /** Claude Tool Use compatible JSON Schema 7 input descriptor. */
  inputSchema: JSONSchema7;
  /** Hard ownership boundary — runtime-enforced. */
  tables: SkillTableAccess;
  /** External API dependencies (env vars, credentials). Optional. */
  dependencies?: readonly SkillExternalDependency[];
  /** True if a single execution is safe to retry without side effects. */
  idempotent: boolean;
  /** Optional: maximum concurrent executions per user. Default 1. */
  maxConcurrentPerUser?: number;
}

// ============================================================================
// Executor — 3-Stage Lifecycle
// ============================================================================

export interface PreflightContext {
  userId: string;
  /** Optional — system/cron skills (trend-collector) have no mandala. */
  mandalaId?: string;
  tier: Tier;
  /** All env vars resolved at boot, frozen reference. */
  env: Readonly<Record<string, string | undefined>>;
}

export interface PreflightResult {
  ok: boolean;
  /** If ok=false, this becomes the skill_runs.error. */
  reason?: string;
  /** Optional: state the executor will hand to execute(). */
  hydrated?: Record<string, unknown>;
}

export interface ExecuteContext extends PreflightContext {
  /** LLM provider — user key takes priority, falls back to Insighta default. */
  llm: GenerationProvider;
  /** Hydrated state from preflight (immutable at executor's discretion). */
  state: Readonly<Record<string, unknown>>;
}

export type ExecuteStatus = 'success' | 'partial' | 'failed';

export interface Deliverable {
  channel: 'inapp' | 'email' | 'webhook' | 'none';
  payload: Record<string, unknown>;
}

export interface ExecuteMetrics {
  duration_ms: number;
  llm_tokens_used?: number;
  /** Per-table row counts written, for ownership audit. */
  rows_written?: Record<string, number>;
}

export interface ExecuteResult {
  status: ExecuteStatus;
  /** Becomes skill_runs.output. Must be JSON-serializable. */
  data: Record<string, unknown>;
  /** Optional: rows the executor wants delivered (mail/push/webhook). */
  deliverables?: Deliverable[];
  metrics?: ExecuteMetrics;
  /** Set when status === 'failed' or 'partial'. */
  error?: string;
}

export interface DeliverContext {
  result: ExecuteResult;
  userId: string;
}

export interface SkillExecutor {
  manifest: SkillManifest;
  /** Cheap, side-effect-free. Validates inputs, env, quota. */
  preflight(ctx: PreflightContext): Promise<PreflightResult>;
  /** Heavy work. Writes only to manifest.tables.write. */
  execute(ctx: ExecuteContext): Promise<ExecuteResult>;
  /** Side-channel delivery (mail/push/webhook). NEVER writes to DB. */
  deliver?(ctx: DeliverContext): Promise<void>;
}
