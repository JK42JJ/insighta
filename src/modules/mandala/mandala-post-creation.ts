/**
 * mandala-post-creation — Phase 3.5 post-creation pipeline
 *
 * Fire-and-forget chain that runs AFTER a mandala has been persisted and
 * the wizard HTTP response has gone back to the user. Two sequential
 * steps, both off the request path:
 *
 *   1. ensureMandalaEmbeddings(mandalaId)
 *        Generate level=1 sub_goal embeddings via Mac Mini Ollama
 *        qwen3-embedding:8b (~8-15s). Idempotent: skipped if already
 *        present, partials are cleaned + regenerated.
 *
 *   2. runVideoDiscover(userId, mandalaId)
 *        Opt-in gated on user_skill_config.video_discover=true. Calls
 *        the video-discover plugin which does YouTube Search with the
 *        user's OAuth token and upserts recommendation_cache rows.
 *
 * The wizard response MUST NOT wait for either step. Both are kicked off
 * via `setImmediate` and all failures are logged + swallowed.
 *
 * Why chain them instead of parallelizing: video-discover's plugin
 * preflight requires level=1 sub_goal embeddings to exist. Running them
 * in parallel would either race or force video-discover to always skip.
 * Sequential with embeddings first is the only correct order.
 *
 * Expected total wall time when OAuth is connected:
 *   ensureEmbeddings (~10s) + runVideoDiscover (~20s) = ~30s background.
 * Response latency added to wizard: 0ms.
 *
 * Opt-in contract for video-discover (step 2):
 *   1. user_skill_config row for this mandala with
 *      skill_type='video_discover' AND enabled=true
 *   2. Valid YouTube OAuth token in youtube_sync_settings
 *   3. level=1 sub_goal embeddings (handled by step 1)
 *   4. keyword_scores has embedded rows (from trend-collector + iks-scorer cron)
 *
 * If ANY are missing, the plugin skip reason is logged at info level
 * and the chain exits cleanly. Nothing is ever thrown back to the caller.
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
import { ensureMandalaEmbeddings } from './ensure-mandala-embeddings';

const log = logger.child({ module: 'mandala-post-creation' });

/** The skill_type string the wizard writes to user_skill_config. */
const WIZARD_SKILL_TYPE = 'video_discover';
/** The plugin id registered in SkillRegistry (kebab-case per plugin arch doc). */
const PLUGIN_SKILL_ID = 'video-discover';

/**
 * Fire-and-forget post-creation pipeline. Returns void synchronously;
 * the actual work runs on the next event loop tick via `setImmediate`.
 *
 * ALWAYS safe to call — all failure modes are logged and swallowed.
 */
export function triggerMandalaPostCreationAsync(userId: string, mandalaId: string): void {
  setImmediate(() => {
    runPostCreation(userId, mandalaId).catch((err) => {
      log.warn(
        `post-creation pipeline crashed for user=${userId} mandala=${mandalaId}: ${err instanceof Error ? err.message : String(err)}`
      );
    });
  });
}

async function runPostCreation(userId: string, mandalaId: string): Promise<void> {
  // ── Step 1: ensure mandala_embeddings (unconditional) ───────────
  // These are a general platform asset — useful for video-discover,
  // similarity search, and the Phase 2b global centroid. We generate
  // them regardless of any skill opt-in.
  try {
    const result = await ensureMandalaEmbeddings(mandalaId);
    if (result.ok) {
      if (result.alreadyPresent) {
        log.info(`embeddings already present for mandala=${mandalaId} (${result.finalCount}/8)`);
      } else {
        log.info(
          `embeddings generated for mandala=${mandalaId} (${result.finalCount}/8 in ${result.embedMs}ms)`
        );
      }
    } else {
      log.warn(
        `embedding generation failed for mandala=${mandalaId}: ${result.reason ?? 'unknown'}`
      );
      // Continue to step 2 — runVideoDiscover will detect missing
      // embeddings in the plugin preflight and return a clean skip.
    }
  } catch (err) {
    log.warn(
      `ensureMandalaEmbeddings threw for mandala=${mandalaId} (continuing): ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // ── Step 2: video-discover (opt-in gated) ────────────────────────
  await runVideoDiscover(userId, mandalaId);
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
    // Expected skip reasons: no OAuth, expired token, no sub_goal embeddings
    // (if step 1 failed), no keyword_scores. These are NOT errors — they're
    // graceful degradation modes the plugin returns so the wizard can proceed.
    log.info(
      `video-discover skipped for user=${userId} mandala=${mandalaId} in ${wallMs}ms — ${result.error ?? 'unknown reason'}`
    );
  }
}
