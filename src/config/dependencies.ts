/**
 * External hosts this service depends on, and what breaks without each.
 *
 * Declared here rather than read from process.env at the route: the hardcode
 * audit rejects direct env access in business logic, and the reason is that a
 * value read in two places ends up meaning two different things.
 *
 * `alternative` is the field that matters. Measured 2026-09-08, three of these
 * were unreachable from a pod and only two of them stopped a feature -- mandala
 * embedding kept working because MANDALA_EMBED_RACE runs OpenRouter alongside
 * the Mac Mini. A list of down hosts cannot express that difference, and it is
 * the whole difference between "degraded" and "unavailable".
 */

export interface ExternalDependency {
  /** Environment variable holding the base URL. */
  env: string;
  /** What stops working when this is unreachable and has no alternative. */
  feature: string;
  /** What carries the feature when this is down, or null if nothing does. */
  alternative: string | null;
}

export const EXTERNAL_DEPENDENCIES: readonly ExternalDependency[] = [
  { env: 'MAC_MINI_TRANSCRIPT_URL', feature: 'transcript ingestion', alternative: null },
  {
    env: 'AZURE_TRANSCRIPT_URL',
    feature: 'transcript ingestion (secondary)',
    alternative: 'mac-mini',
  },
  {
    env: 'MANDALA_GEN_URL',
    feature: 'mandala embedding',
    alternative: 'openrouter (MANDALA_EMBED_RACE)',
  },
  { env: 'SNAPSHOT_SERVICE_URL', feature: 'note figure enrichment', alternative: null },
  { env: 'QWEN_LORA_API_URL', feature: 'chatbot (self-hosted)', alternative: 'openrouter' },
] as const;

/**
 * The configured URL for a dependency, or null.
 *
 * The single env read for this list, kept beside the declaration so the audit
 * has one place to look and so does a person.
 */
export function dependencyUrl(
  dep: ExternalDependency,
  env: NodeJS.ProcessEnv = process.env
): string | null {
  const raw = env[dep.env];
  return raw && raw.length > 0 ? raw : null;
}
