/**
 * Normalise a RunPod endpoint URL to its OpenAI-compatible base.
 *
 * Accepts:
 *   https://<pod>.proxy.runpod.net/v1                → unchanged
 *     (standard vLLM Pod started WITHOUT `--root-path /openai`, CP475+1)
 *   https://api.runpod.ai/v2/<id>/openai/v1          → unchanged
 *     (Serverless or Pod started WITH `--root-path /openai`)
 *   https://api.runpod.ai/v2/<id>/runsync            → .../v2/<id>/openai/v1
 *   https://api.runpod.ai/v2/<id>                    → .../v2/<id>/openai/v1
 *
 * Extracted from `copilotkit.ts` into its own module so unit tests can
 * import the pure utility without triggering the route module's
 * top-level `config/index.ts` env-validation side effect.
 *
 * CP475+1 (2026-05-20) — pre-fix the function only handled `/openai/v1`,
 * so a Pod URL like `.../v1` was silently turned into `.../v1/openai/v1`
 * (404). The `/v1`-passthrough branch fixes the post-migration Pod path.
 */
export function toRunpodOpenAiBase(raw: string): string {
  const trimmed = raw.replace(/\/+$/, '');
  if (trimmed.endsWith('/openai/v1')) return trimmed;
  if (trimmed.endsWith('/v1')) return trimmed;
  return trimmed.replace(/\/(?:runsync|run)$/, '') + '/openai/v1';
}
