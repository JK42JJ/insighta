/**
 * Registry Adapter — Plugin → InsightaSkill bridge
 *
 * Wraps a plugin (`SkillExecutor`) so it can be registered into the existing
 * SkillRegistry (`src/modules/skills/registry.ts`). This is the single integration
 * point between the new plugin world (src/skills/) and the legacy flat-skill
 * world (src/modules/skills/) — see plugin architecture doc §9.
 *
 * Why an adapter and not a re-implementation:
 *  - Reuses skill_runs logging, quota gates, tier filtering, sidebar/UI surfaces
 *  - Existing /api/v1/skills routes work for plugins automatically
 *  - Migration cost for existing 7 flat skills stays at zero
 *
 * Phase: 1 (CP352, #366)
 */

import { skillRegistry } from '@/modules/skills';
import type {
  InsightaSkill,
  SkillContext,
  SkillResult,
  SkillPreview,
} from '@/modules/skills/types';
import type { SkillExecutor, PreflightContext, ExecuteContext } from './types';
import { validateManifest } from './runtime';
import { logger } from '@/utils/logger';

const log = logger.child({ module: 'PluginAdapter' });

/**
 * Convert a plugin's SkillExecutor into an InsightaSkill that the legacy
 * SkillRegistry can register and execute.
 *
 * Lifecycle mapping:
 *   InsightaSkill.execute(ctx)  →  preflight() → execute() → deliver?()
 *   InsightaSkill.dryRun(ctx)   →  preflight() only (read-only by contract)
 */
export function wrapPluginAsSkill(executor: SkillExecutor): InsightaSkill {
  const { manifest } = executor;

  // Frozen + validated env snapshot for the lifetime of the wrapper.
  // Captured ONCE at registration so plugins cannot mutate process.env.
  const envSnapshot: Readonly<Record<string, string | undefined>> = Object.freeze({
    ...process.env,
  });

  return {
    id: manifest.id,
    version: manifest.version,
    description: manifest.description,
    trigger: manifest.trigger,
    tiers: manifest.tiers,
    inputSchema: manifest.inputSchema,

    async execute(ctx: SkillContext): Promise<SkillResult> {
      const t0 = Date.now();

      // 1. preflight
      const pre: PreflightContext = {
        userId: ctx.userId,
        mandalaId: ctx.mandalaId,
        tier: ctx.tier,
        env: envSnapshot,
      };
      const preflight = await executor.preflight(pre);
      if (!preflight.ok) {
        return {
          success: false,
          error: preflight.reason ?? 'preflight failed',
          metadata: { duration_ms: Date.now() - t0 },
        };
      }

      // 2. execute
      const exe: ExecuteContext = {
        ...pre,
        llm: ctx.llm,
        state: Object.freeze(preflight.hydrated ?? {}),
      };
      const result = await executor.execute(exe);

      // 3. deliver (optional)
      if (executor.deliver && result.status !== 'failed') {
        try {
          await executor.deliver({ result, userId: ctx.userId });
        } catch (err) {
          // deliver failures must NOT corrupt execute() data — log and continue.
          // Plugin author opted into deliver(); they own its idempotency.
          log.error(`deliver() failed for skill ${manifest.id}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      return {
        success: result.status === 'success',
        data: result.data,
        error: result.error,
        metadata: {
          duration_ms: result.metrics?.duration_ms ?? Date.now() - t0,
          llm_tokens_used: result.metrics?.llm_tokens_used,
        },
      };
    },

    async dryRun(ctx: SkillContext): Promise<SkillPreview> {
      // Plugins don't define dryRun explicitly — preflight is the read-only
      // probe. We surface its outcome as a minimal SkillPreview so the sidebar
      // can render *something* without firing the full pipeline.
      const pre: PreflightContext = {
        userId: ctx.userId,
        mandalaId: ctx.mandalaId,
        tier: ctx.tier,
        env: envSnapshot,
      };
      const preflight = await executor.preflight(pre);
      return {
        subject: manifest.description,
        preview_html: preflight.ok
          ? `<p>Ready to run <code>${manifest.id}</code> v${manifest.version}.</p>`
          : `<p><strong>Not ready:</strong> ${preflight.reason ?? 'preflight failed'}</p>`,
        curated_count: 0,
      };
    },
  };
}

/**
 * Validate manifest, wrap as InsightaSkill, and register into skillRegistry.
 *
 * This is the ONE function plugins call from src/skills/index.ts. It is the
 * single boundary where a manifest goes from "compiled-but-unverified" to
 * "live in the registry".
 */
export function registerPlugin(executor: SkillExecutor): void {
  validateManifest(executor.manifest);
  const adapted = wrapPluginAsSkill(executor);
  skillRegistry.register(adapted);
  log.info(
    `Plugin registered: ${executor.manifest.id} v${executor.manifest.version} (Layer ${executor.manifest.layer})`
  );
}
