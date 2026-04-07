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
import { VideoScriptSkill } from './video-script';
import { BlogPostSkill } from './blog-post';
// VideoDiscoverSkill BETA stub removed in CP352 — real plugin lives at
// src/skills/plugins/video-discover/ (registered via src/skills/index.ts).

// Skill registration — add one line per new skill
skillRegistry.register(new NewsletterSkill());
skillRegistry.register(new ResearchReportSkill());
skillRegistry.register(new AlertSkill());
skillRegistry.register(new RecommendSkill());
skillRegistry.register(new VideoScriptSkill());
skillRegistry.register(new BlogPostSkill());
// (video-discover BETA stub removed — real plugin in src/skills/plugins/video-discover/)

// New-style plugin registration entrypoint (#358 Phase 1+).
// Side-effect import: registers all plugins under src/skills/plugins/.
import '@/skills';

export { skillRegistry };
export { checkSkillQuota } from './quota-checker';
export { checkSummaryQuality } from './summary-gate';
export type { InsightaSkill, SkillContext, SkillResult, SkillPreview, SkillTrigger } from './types';
export type { GateResult, RichSummary } from './summary-gate';
