/**
 * mandala-post-creation
 *
 * Fire-and-forget chain that runs AFTER a mandala has been persisted and
 * the wizard HTTP response has gone back to the user. Two sequential
 * steps, both off the request path:
 *
 *   1. ensureMandalaEmbeddings(mandalaId) — generate level=1 sub_goal
 *      embeddings via Mac Mini Ollama qwen3-embedding:8b (~8-15s),
 *      idempotent.
 *
 *   2. runVideoDiscover(userId, mandalaId) — opt-in gated on
 *      user_skill_config.video_discover=true. Calls the video-discover
 *      plugin which does YouTube Search with the user's OAuth token
 *      and upserts recommendation_cache rows.
 *
 * The wizard response MUST NOT wait for either step. Both are kicked off
 * via `setImmediate` and all failures are logged + swallowed.
 *
 * Steps are sequential, not parallel: video-discover's preflight
 * requires level=1 sub_goal embeddings from step 1.
 *
 * Opt-in contract for video-discover (step 2):
 *   1. user_skill_config row with skill_type='video_discover' and
 *      enabled=true
 *   2. Valid YouTube OAuth token in youtube_sync_settings
 *   3. level=1 sub_goal embeddings (handled by step 1)
 *   4. keyword_scores has embedded rows (from trend-collector + iks-scorer cron)
 *
 * If ANY are missing, the plugin skip reason is logged at info level
 * and the chain exits cleanly.
 *
 * Naming: user_skill_config.skill_type is 'video_discover' (underscore),
 * the plugin id in SkillRegistry is 'video-discover' (kebab-case per
 * docs/design/insighta-skill-plugin-architecture.md §3). This helper
 * translates between them.
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
 * Dedup window — when this hook fires from an UPDATE path (e.g. user
 * edits a sub_goal label), we may have already run video-discover for
 * the same mandala minutes ago. Re-running would burn YouTube Search
 * quota for marginal benefit. If ANY recommendation_cache row exists for
 * this mandala newer than this window, the next runVideoDiscover skips.
 *
 * 5 minutes is a deliberate floor: long enough to absorb wizard rapid-
 * edit bursts, short enough that a real "I changed my mandala, please
 * refresh" intent will land within the next pipeline tick.
 */
const RECENT_DISCOVER_WINDOW_MS = 5 * 60 * 1000;

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
  //
  // Short-circuit contract: if embeddings aren't ready at the end of
  // step 1, DO NOT dispatch step 2. video-discover's preflight would
  // skip anyway for "no sub_goal embeddings", so calling it would waste:
  //   - 2 DB queries (user_skill_config + user_subscriptions)
  //   - LLM provider init
  //   - skill_runs INSERT/UPDATE for a guaranteed failure
  let embeddingsReady = false;
  try {
    const result = await ensureMandalaEmbeddings(mandalaId);
    if (result.ok) {
      embeddingsReady = true;
      if (result.alreadyPresent) {
        log.info(`embeddings already present for mandala=${mandalaId} (${result.finalCount}/8)`);
      } else {
        log.info(
          `embeddings generated for mandala=${mandalaId} (${result.finalCount}/8 in ${result.embedMs}ms)`
        );
      }
    } else {
      log.warn(
        `embedding generation failed for mandala=${mandalaId}: ${result.reason ?? 'unknown'} — skipping video-discover`
      );
    }
  } catch (err) {
    log.warn(
      `ensureMandalaEmbeddings threw for mandala=${mandalaId}: ${err instanceof Error ? err.message : String(err)} — skipping video-discover`
    );
  }

  if (!embeddingsReady) {
    // Stop here. Each step's precondition is verifiable before the next
    // step runs — don't waste downstream resources on a guaranteed skip.
    return;
  }

  // ── Step 2: video-discover (opt-in gated) ────────────────────────
  await runVideoDiscover(userId, mandalaId);
}

async function runVideoDiscover(userId: string, mandalaId: string): Promise<void> {
  const db = getPrismaClient();

  // Dedup gate: skip if we already produced a recommendation_cache row
  // for this mandala within RECENT_DISCOVER_WINDOW_MS. Protects YouTube
  // Search quota when this hook fires repeatedly from edit/update paths.
  // Checked BEFORE opt-in/tier/LLM lookups so a hot-path skip costs one
  // indexed point query.
  const cutoff = new Date(Date.now() - RECENT_DISCOVER_WINDOW_MS);
  const recent = await db.recommendation_cache.findFirst({
    where: { mandala_id: mandalaId, created_at: { gt: cutoff } },
    select: { id: true, created_at: true },
    orderBy: { created_at: 'desc' },
  });
  if (recent) {
    const ageSec = Math.round((Date.now() - recent.created_at.getTime()) / 1000);
    log.info(
      `video-discover skipped (dedup) for mandala=${mandalaId} — last run ${ageSec}s ago, window=${RECENT_DISCOVER_WINDOW_MS / 1000}s`
    );
    return;
  }

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
