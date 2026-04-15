/**
 * Skill Plugin Registration — Single Entrypoint
 *
 * Importing this module side-effects all plugin registrations into the
 * existing SkillRegistry (`src/modules/skills/registry.ts`).
 *
 * Add new plugins here as one line each, mirroring the legacy
 * `src/modules/skills/index.ts` pattern.
 *
 * Boot path: src/modules/skills/index.ts → import '@/skills' → this file
 * → registerPlugin(executor) → skillRegistry.register(adapted)
 *
 * Authoritative spec: docs/design/insighta-skill-plugin-architecture.md §9
 */

import { registerPlugin } from './_shared/registry-adapter';
import { executor as trendCollector } from './plugins/trend-collector/executor';
import { executor as iksScorer } from './plugins/iks-scorer/executor';
import { executor as videoDiscover } from './plugins/video-discover/executor';
import { executor as videoDiscoverV2 } from './plugins/video-discover/v2/executor';
import { executor as videoDiscoverV3 } from './plugins/video-discover/v3/executor';
import { executor as batchVideoCollector } from './plugins/batch-video-collector/executor';

// Plugin registrations — one line per plugin.
registerPlugin(trendCollector);
registerPlugin(iksScorer);
registerPlugin(videoDiscover);
// v2 coexists with v1 under id 'video-discover-v2'. Pipeline-runner picks
// which to call based on env flag VIDEO_DISCOVER_V2.
registerPlugin(videoDiscoverV2);
// v3 — Tier 1 (video_pool cache) + Tier 2 (realtime deficit fill). Selected
// by env flag VIDEO_DISCOVER_V3, which takes priority over V2.
registerPlugin(videoDiscoverV3);
// Daily batch — Source A: trend keywords → video_pool cache.
// Triggered by GitHub Actions (cron) via internal HTTP endpoint.
registerPlugin(batchVideoCollector);

// Re-exports for callers that want types or the adapter directly.
export { registerPlugin } from './_shared/registry-adapter';
export type {
  SkillManifest,
  SkillExecutor,
  PreflightContext,
  PreflightResult,
  ExecuteContext,
  ExecuteResult,
} from './_shared/types';
