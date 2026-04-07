/**
 * Skill Plugin Runtime — manifest validation + helpers
 *
 * Authoritative spec: docs/design/insighta-skill-plugin-architecture.md §6
 *
 * Hard rules enforced here (boot-time, fail-fast):
 *  - manifest must be Object.freeze'd
 *  - tables.read / tables.write arrays must be defined (even if empty)
 *  - idempotent must be a boolean (no implicit default)
 *  - dependencies[].env must reference an existing env var if required=true
 *  - cron trigger schedule must be a non-empty string
 *
 * Phase: 1 (CP352, #366)
 */

import type { SkillManifest } from './types';

/**
 * Define + freeze a plugin manifest in one step.
 *
 * Why a helper rather than `Object.freeze({...}) satisfies SkillManifest`:
 * `Object.freeze`'s type signature widens literal arrays/strings before
 * `satisfies` can validate them, producing spurious assignability errors on
 * `tiers`, `inputSchema.type`, and `tables.write`. The generic constraint
 * here narrows literals via T while still enforcing structural compliance
 * with SkillManifest at the call site.
 */
export function defineManifest<T extends SkillManifest>(m: T): Readonly<T> {
  return Object.freeze(m);
}

export class SkillManifestError extends Error {
  constructor(skillId: string, reason: string) {
    super(`[skill:${skillId}] manifest invalid — ${reason}`);
    this.name = 'SkillManifestError';
  }
}

/**
 * Validate a manifest. Throws SkillManifestError on the first violation.
 *
 * Called by `registerPlugin()` before the plugin is wrapped + registered.
 * In dev/test, this hard-fails boot. In prod, callers should still throw —
 * shipping a broken manifest is a deploy bug, not a runtime warning.
 */
export function validateManifest(m: SkillManifest): void {
  if (!m.id || typeof m.id !== 'string') {
    throw new SkillManifestError(String(m.id), 'id must be a non-empty string');
  }
  if (!/^[a-z][a-z0-9-]*$/.test(m.id)) {
    throw new SkillManifestError(m.id, 'id must be kebab-case (^[a-z][a-z0-9-]*$)');
  }
  if (!m.version || typeof m.version !== 'string') {
    throw new SkillManifestError(m.id, 'version must be a non-empty string');
  }
  if (m.layer !== 'A' && m.layer !== 'B' && m.layer !== 'C') {
    throw new SkillManifestError(m.id, `layer must be A | B | C (got ${String(m.layer)})`);
  }
  if (typeof m.idempotent !== 'boolean') {
    throw new SkillManifestError(m.id, 'idempotent must be declared as boolean (no default)');
  }
  if (!m.tables || !Array.isArray(m.tables.read) || !Array.isArray(m.tables.write)) {
    throw new SkillManifestError(m.id, 'tables.read and tables.write must be arrays');
  }
  if (!m.tiers || m.tiers.length === 0) {
    throw new SkillManifestError(m.id, 'tiers must be non-empty');
  }

  // Trigger shape
  switch (m.trigger.type) {
    case 'manual':
      break;
    case 'cron':
      if (!m.trigger.schedule || typeof m.trigger.schedule !== 'string') {
        throw new SkillManifestError(m.id, 'cron trigger requires non-empty schedule');
      }
      break;
    case 'event':
      if (!m.trigger.event) {
        throw new SkillManifestError(m.id, 'event trigger requires event name');
      }
      break;
    default: {
      // Exhaustiveness check
      const _exhaustive: never = m.trigger;
      throw new SkillManifestError(m.id, `unknown trigger ${JSON.stringify(_exhaustive)}`);
    }
  }

  // Dependencies (optional)
  if (m.dependencies) {
    for (const dep of m.dependencies) {
      if (!dep.name || !dep.env) {
        throw new SkillManifestError(m.id, `dependency missing name/env: ${JSON.stringify(dep)}`);
      }
    }
  }

  // Frozen check — last so the more useful errors fire first
  if (!Object.isFrozen(m)) {
    throw new SkillManifestError(m.id, 'manifest must be Object.freeze()d (immutability rule)');
  }
}

/**
 * Resolve env vars required by the manifest. Returns the missing required
 * dependency names (empty array = all satisfied).
 *
 * Called by executor.preflight() — does NOT throw, lets the plugin decide
 * whether to fail or run in degraded mode.
 */
export function checkRequiredDependencies(
  manifest: SkillManifest,
  env: Readonly<Record<string, string | undefined>>
): string[] {
  if (!manifest.dependencies) return [];
  const missing: string[] = [];
  for (const dep of manifest.dependencies) {
    if (dep.required && !env[dep.env]) {
      missing.push(dep.env);
    }
  }
  return missing;
}
