/**
 * video-discover trigger — Phase 3.5 mandala.created event wiring
 *
 * Fire-and-forget invocation of the video-discover plugin for a newly
 * created mandala. Safe to call from any mandala creation endpoint —
 * errors are caught and logged, never propagated to the API caller.
 *
 * The wizard response returns to the user IMMEDIATELY; the heavy
 * video-discover pipeline (8 YouTube Search calls + videos.list batch +
 * recommendation_cache upserts, ~15-30s wall time) runs asynchronously
 * via `setImmediate`. Recommendations appear in the dashboard some
 * seconds later.
 *
 * Opt-in contract (all must be true for the trigger to actually run):
 *   1. user_skill_config row exists for this mandala with
 *      skill_type='video_discover' AND enabled=true
 *      (the wizard writes this when the user checks the video-discover
 *      card in Step 3)
 *   2. User has a valid YouTube OAuth token in youtube_sync_settings
 *      (plugin preflight enforces this — returns skip reason if missing)
 *   3. Mandala has level=1 sub_goal embeddings in mandala_embeddings
 *      (plugin preflight enforces this; until the embedding generation
 *      pipeline runs on user mandalas, this is a silent skip — see
 *      CP353 carry-over "mandala_embeddings auto-generation for
 *      user-created mandalas")
 *   4. keyword_scores has at least N rows with embeddings (populated
 *      by the trend-collector + iks-scorer nightly cron)
 *
 * If ANY of these are missing the plugin returns success=false with a
 * human-readable reason. We log at info level and move on — never
 * throw, never block the wizard.
 *
 * Naming note: user_skill_config.skill_type uses 'video_discover'
 * (underscore, legacy from the BETA stub). The new plugin architecture
 * registers the real plugin with id 'video-discover' (kebab-case per
 * docs/design/insighta-skill-plugin-architecture.md §3). This helper
 * bridges the two names so the wizard's existing skill config data
 * keeps working without a migration.
 */

import { skillRegistry } from '@/modules/skills';
import { getPrismaClient } from '@/modules/database';
import { createGenerationProvider } from '@/modules/llm';
import type { Tier } from '@/config/quota';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'video-discover-trigger' });

/** The skill_type string the wizard writes to user_skill_config. */
const WIZARD_SKILL_TYPE = 'video_discover';
/** The plugin id registered in SkillRegistry (kebab-case per plugin arch doc). */
const PLUGIN_SKILL_ID = 'video-discover';

/**
 * Fire-and-forget invocation. Returns immediately; the actual video-discover
 * pipeline runs on the next event loop tick via `setImmediate`.
 *
 * ALWAYS safe to call — all failure modes are logged and swallowed.
 */
export function triggerVideoDiscoverAsync(userId: string, mandalaId: string): void {
  setImmediate(() => {
    runVideoDiscover(userId, mandalaId).catch((err) => {
      log.warn(
        `video-discover async trigger crashed for user=${userId} mandala=${mandalaId}: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  });
}

async function runVideoDiscover(userId: string, mandalaId: string): Promise<void> {
  const db = getPrismaClient();

  // Opt-in gate: the user must have enabled video_discover in the wizard
  // Step 3 skill config. If not enabled (or no row), silently skip.
  const config = await db.user_skill_config.findFirst({
    where: {
      user_id: userId,
      mandala_id: mandalaId,
      skill_type: WIZARD_SKILL_TYPE,
    },
    select: { enabled: true },
  });
  if (!config?.enabled) {
    log.info(`video-discover skipped — not enabled for user=${userId} mandala=${mandalaId}`);
    return;
  }

  // Resolve user tier for SkillContext (needed by skillRegistry quota gates)
  const sub = await db.user_subscriptions.findUnique({
    where: { user_id: userId },
    select: { tier: true },
  });
  const tier = (sub?.tier ?? 'free') as Tier;

  // LLM provider — video-discover doesn't actually use llm but the
  // SkillContext contract requires one
  const llm = await createGenerationProvider();

  const t0 = Date.now();
  const result = await skillRegistry.execute(PLUGIN_SKILL_ID, {
    userId,
    mandalaId,
    tier,
    llm,
  });
  const wallMs = Date.now() - t0;

  if (result.success) {
    log.info(
      `video-discover completed for user=${userId} mandala=${mandalaId} in ${wallMs}ms: ${JSON.stringify(result.data ?? {})}`
    );
  } else {
    // Expected skip reasons: no OAuth, expired token, no sub_goal embeddings,
    // no keyword_scores. These are NOT errors — they're graceful degradation
    // modes the plugin returns so the wizard can proceed.
    log.info(
      `video-discover skipped for user=${userId} mandala=${mandalaId} in ${wallMs}ms — ${result.error ?? 'unknown reason'}`
    );
  }
}
