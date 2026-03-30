/**
 * Skill System — Entry Point
 *
 * Register all skills here. New skills require only one line.
 * Import this module in server initialization to activate skills.
 *
 * Design: docs/design/skill-registry-handoff.md
 * Issue: #337 (Step 2)
 */

import { skillRegistry } from './registry';
import { NewsletterSkill } from './newsletter';
import { ResearchReportSkill } from './research-report';
import { AlertSkill } from './alert';
import { RecommendSkill } from './recommend';

// Skill registration — add one line per new skill
skillRegistry.register(new NewsletterSkill());
skillRegistry.register(new ResearchReportSkill());
skillRegistry.register(new AlertSkill());
skillRegistry.register(new RecommendSkill());

export { skillRegistry };
export { checkSkillQuota } from './quota-checker';
export { checkSummaryQuality } from './summary-gate';
export type { InsightaSkill, SkillContext, SkillResult, SkillPreview, SkillTrigger } from './types';
export type { GateResult, RichSummary } from './summary-gate';
