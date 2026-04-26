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

// Skill registration — add one line per new skill
skillRegistry.register(new NewsletterSkill());
skillRegistry.register(new ResearchReportSkill());
skillRegistry.register(new AlertSkill());
skillRegistry.register(new RecommendSkill());
skillRegistry.register(new VideoScriptSkill());
skillRegistry.register(new BlogPostSkill());

// Plugin registration entrypoint (#358). Side-effect import: each plugin
// under src/skills/plugins/ registers itself into skillRegistry.
// Explicit `/index` is required — tsconfig paths maps `@/skills/*`
// (wildcard only), so bare `@/skills` fails at runtime in tsx.
import '@/skills/index';

export { skillRegistry };
export { checkSkillQuota } from './quota-checker';
export { checkSummaryQuality, isV2Summary } from './summary-gate';
export type { InsightaSkill, SkillContext, SkillResult, SkillPreview, SkillTrigger } from './types';
export type { GateResult, RichSummary, RichSummaryV1, RichSummaryV2 } from './summary-gate';
