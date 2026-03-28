/**
 * Skill entity types — frontend-side definitions
 * Mirrors backend src/modules/skills/types.ts
 */

export type SkillTrigger =
  | { type: 'cron'; schedule: string }
  | { type: 'event'; event: string }
  | { type: 'manual' };

export interface SkillListItem {
  id: string;
  description: string;
  version: string;
  trigger: SkillTrigger;
  inputSchema: Record<string, unknown>;
}

export interface SkillPreview {
  subject?: string;
  preview_html?: string;
  curated_count?: number;
}

export interface SkillResult {
  success: boolean;
  data?: Record<string, unknown>;
  error?: string;
  metadata?: {
    duration_ms: number;
    llm_tokens_used?: number;
    quota_exceeded?: boolean;
  };
}

/** Skill display metadata — UI-only, not from API */
export const SKILL_DISPLAY: Record<string, { icon: string; labelKey: string }> = {
  newsletter: { icon: 'Mail', labelKey: 'skills.newsletter' },
  report: { icon: 'FileText', labelKey: 'skills.report' },
  alert: { icon: 'Bell', labelKey: 'skills.alert' },
  recommend: { icon: 'Sparkles', labelKey: 'skills.recommend' },
};
