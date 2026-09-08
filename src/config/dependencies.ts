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
  /** Where the host lives when it is a constant in the code rather than an env
   *  var. Without this the SaaS dependencies -- which nobody configures because
   *  their address never changes -- would report as "not configured" and the
   *  list would claim to be complete while omitting the ones that carry the
   *  most traffic. */
  url?: string;
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

  // The hosts that are not ours. They were missing from the first version of
  // this list, which made it a list of self-hosted boxes wearing the name of a
  // complete one -- and OpenRouter alone is behind summaries, the chatbot and
  // every embedding that falls back to it. Addresses are constants in the code
  // (llm-reranker.ts, youtube-client.ts, config/index.ts) and repeated here
  // because a probe needs the host, not the full request path.
  {
    env: 'OPENROUTER_API_URL',
    url: 'https://openrouter.ai',
    feature: 'LLM calls — summaries, chatbot, embeddings',
    alternative: null,
  },
  {
    env: 'YOUTUBE_API_BASE',
    url: 'https://www.googleapis.com',
    feature: 'video discovery and metadata',
    alternative: null,
  },
  { env: 'SUPABASE_URL', feature: 'auth and edge functions', alternative: null },
  {
    env: 'GMAIL_SMTP_HOST',
    url: 'smtp://smtp-relay.gmail.com:587',
    feature: 'newsletter delivery',
    alternative: null,
  },

  // OLLAMA_URL is deliberately absent. Its default is localhost:11434, which
  // inside a pod is nothing, so it would report a permanent outage for a path
  // production does not use -- the Mac Mini embedding host is MANDALA_GEN_URL
  // above and is already measured.
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
  if (raw && raw.length > 0) return raw;
  return dep.url ?? null;
}
