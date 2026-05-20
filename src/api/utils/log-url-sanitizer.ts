/**
 * URL sanitiser for fastify pino request logs.
 *
 * `EventSource` (browser SSE primitive) cannot send custom Authorization
 * headers, so any auth-protected SSE endpoint accepts the JWT via the
 * `?access_token=` query parameter. fastify's default `req` serializer
 * stores `req.url` verbatim → the JWT lands in production logs in
 * plaintext.
 *
 * This helper masks any auth-bearing query value so the URL stays useful
 * for debugging (path + other params visible) without leaking secrets.
 *
 * Covered params (case-insensitive):
 *   - access_token
 *   - id_token
 *   - refresh_token
 *   - token
 *   - api_key
 *
 * Refs: CP475+7 — JWT leak via `/api/v1/mandalas/:id/videos/stream?access_token=...`
 * surfaced in prod logs during the CP475 chatbot saga.
 */

const SENSITIVE_QUERY_PARAMS = [
  'access_token',
  'id_token',
  'refresh_token',
  'token',
  'api_key',
] as const;

const REDACTED = '<redacted>';

const REDACT_REGEX = new RegExp(`(?<=[?&])(${SENSITIVE_QUERY_PARAMS.join('|')})=[^&#]+`, 'gi');

/**
 * Returns the URL with sensitive query parameter VALUES replaced by
 * `<redacted>`. Param names + everything else is left untouched.
 *
 * Examples:
 *   /a/b?access_token=eyJh.abc&lastEventId=42
 *     → /a/b?access_token=<redacted>&lastEventId=42
 *   /a/b?lastEventId=42
 *     → /a/b?lastEventId=42   (unchanged)
 */
export function sanitizeLogUrl(url: string | undefined | null): string {
  if (!url) return url ?? '';
  return url.replace(REDACT_REGEX, (_match, paramName: string) => `${paramName}=${REDACTED}`);
}
