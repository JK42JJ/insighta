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

// Skill registration — add one line per new skill
// skillRegistry.register(new NewsletterSkill())  // Step 4
// skillRegistry.register(new ReportSkill())      // future
// skillRegistry.register(new AlertSkill())       // future

export { skillRegistry };
export type { InsightaSkill, SkillContext, SkillResult, SkillPreview, SkillTrigger } from './types';
