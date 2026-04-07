/**
 * VideoDiscoverSkill — BETA placeholder
 *
 * This is a Phase 0 STUB that exists solely so the skill is visible in the
 * SidebarSkillPanel + dashboard chips with a "BETA — coming soon" state.
 * The actual recommendation engine ships in #358 Phase 3 (skill plugin
 * `src/skills/plugins/video-discover/`) once trend-collector (#359) and
 * IKS-scorer (#360) populate trend_signals + keyword_scores + the
 * recommendation_cache rows this skill will eventually consume.
 *
 * Until then:
 *   - dryRun() returns a "Coming soon" preview so the sidebar can render
 *     the entry without fetching real data.
 *   - execute() returns success=false with a clear BETA marker so any
 *     accidental invocation surfaces the not-yet-shipped status to the
 *     user instead of silently writing skill_outputs garbage.
 *
 * When the real plugin lands in #358 Phase 3, delete this file and
 * unregister it from src/modules/skills/index.ts.
 *
 * Refs: #358 (Epic), #361 (Phase 3 video-discover plugin), CP351
 */

import type { InsightaSkill, SkillContext, SkillResult, SkillPreview } from './types';

export class VideoDiscoverSkill implements InsightaSkill {
  id = 'video_discover' as const;
  version = '0.0.0-beta';
  description = 'AI video discovery — find YouTube videos that match your goal + current trends';
  trigger = { type: 'manual' as const };
  tiers = ['free', 'pro', 'lifetime', 'admin'] as const;

  inputSchema: InsightaSkill['inputSchema'] = {
    type: 'object',
    properties: {
      mandala_id: {
        type: 'string',
        description: 'Mandala ID whose sub_goals should drive the discovery',
      },
    },
    required: ['mandala_id'],
  };

  async execute(_ctx: SkillContext): Promise<SkillResult> {
    return {
      success: false,
      error: 'BETA — video discovery is not yet shipped. Tracked in #358 Phase 3 (#361).',
      metadata: { duration_ms: 0 },
    };
  }

  async dryRun(_ctx: SkillContext): Promise<SkillPreview> {
    return {
      subject: 'YouTube Card Discovery (BETA)',
      preview_html:
        '<p><strong>Coming soon.</strong> This skill will surface YouTube videos that match your mandala sub-goals and current trends, scored by Insighta Keyword Score (search demand × goal relevance × content performance × learning value).</p><p>Toggle ON now to opt in — it will activate automatically the moment the backend ships (#358 Phase 3).</p>',
      curated_count: 0,
    };
  }
}
