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

// Plugin registrations — one line per plugin.
registerPlugin(trendCollector);
registerPlugin(iksScorer);
registerPlugin(videoDiscover);

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
