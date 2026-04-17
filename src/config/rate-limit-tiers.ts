/**
 * Cost-Tier Rate Limit Configuration
 *
 * Modeled after GitHub's multi-dimensional rate limiting:
 *   - Primary (total requests per user)
 *   - Point-based per endpoint (Cost-Tier A/B/C/D)
 *   - Concurrency (simultaneous in-flight requests)
 *
 * Each endpoint is assigned a tier based on its resource cost, NOT its
 * HTTP method. GET /search (vector DB) is tier B, not "free read".
 *
 * Created: 2026-04-17 after incident where global 100/15min killed
 * service on 13 refreshes. Design informed by GitHub API, Stripe,
 * and Cloudflare rate limit patterns.
 */

export type CostTier = 'A' | 'B' | 'C' | 'D';

/**
 * Token bucket configuration per tier.
 *   points  = bucket size (max burst)
 *   duration = refill window in seconds
 *
 * Effective rate: points / duration per second.
 */
export const TIER_CONFIG: Record<CostTier, { points: number; duration: number }> = {
  /** Tier A: near-free — indexed DB reads, cached responses */
  A: { points: 300, duration: 60 },
  /** Tier B: moderate — vector search, heavy joins, aggregations */
  B: { points: 60, duration: 60 },
  /** Tier C: expensive — LLM calls, external API (YouTube, OpenRouter) */
  C: { points: 10, duration: 60 },
  /** Tier D: state-changing writes — mandala create, card add, note save */
  D: { points: 30, duration: 60 },
};

/** Max concurrent in-flight requests per user (across all tiers). */
export const MAX_CONCURRENCY_PER_USER = 15;

/**
 * Route → Tier mapping. Key format: "METHOD /path" (no prefix).
 * Parametric segments use :param notation matching Fastify's routerPath.
 *
 * IMPORTANT: Every authenticated route MUST appear here. The onRoute
 * hook throws at boot if a route is missing — fail-fast, not fail-silent.
 * Add new routes to this map BEFORE registering them.
 */
export const ENDPOINT_TIERS: Record<string, CostTier> = {
  // ── Tier A: cheap reads ─────────────────────────────────────────────
  'GET /api/v1/auth/me': 'A',
  'GET /api/v1/mandalas': 'A',
  'GET /api/v1/mandalas/list': 'A',
  'GET /api/v1/mandalas/default': 'A',
  'GET /api/v1/mandalas/:id': 'A',
  'GET /api/v1/mandalas/:id/levels': 'A',
  'GET /api/v1/mandalas/:id/recommendations': 'A',
  'GET /api/v1/playlists': 'A',
  'GET /api/v1/playlists/:id': 'A',
  'GET /api/v1/playlists/:id/videos': 'A',
  'GET /api/v1/videos': 'A',
  'GET /api/v1/videos/:id': 'A',
  'GET /api/v1/videos/:id/notes': 'A',
  'GET /api/v1/videos/:id/notes/rich': 'A',
  'GET /api/v1/subscriptions/current': 'A',
  'GET /api/v1/subscriptions/updates': 'A',
  'GET /api/v1/skills': 'A',
  'GET /api/v1/skills/:mandalaId/outputs': 'A',
  'GET /api/v1/quota/status': 'A',
  'GET /api/v1/settings': 'A',
  'GET /api/v1/settings/youtube': 'A',
  'GET /api/v1/admin/enrichment/status': 'A',
  'GET /api/v1/admin/enrichment/summaries': 'A',
  'GET /api/v1/admin/pipeline/runs': 'A',
  'GET /api/v1/admin/pipeline/runs/:id': 'A',

  // ── Tier B: moderate (search, explore, aggregations) ────────────────
  'GET /api/v1/mandalas/explore': 'B',
  'GET /api/v1/mandalas/public/:slugOrId': 'B',
  'POST /api/v1/mandalas/search-by-goal': 'B',
  'GET /api/v1/analytics/weekly-report': 'B',
  'GET /api/v1/videos/:id/summary': 'B',

  // ── Tier C: expensive (LLM, external API) ───────────────────────────
  'POST /api/v1/mandalas/generate': 'C',
  'POST /api/v1/mandalas/generate-labels': 'C',
  'POST /api/v1/skills/:mandalaId/execute': 'C',
  'POST /api/v1/skills/:mandalaId/preview': 'C',
  'POST /api/v1/admin/enrichment/retry': 'C',

  // ── Tier D: writes ──────────────────────────────────────────────────
  'POST /api/v1/mandalas/create': 'D',
  'POST /api/v1/mandalas/create-with-data': 'D',
  'POST /api/v1/mandalas/create-from-template': 'D',
  'POST /api/v1/mandalas/prewarm': 'D',
  'POST /api/v1/mandalas/source-mappings': 'D',
  'POST /api/v1/mandalas/:id/like': 'D',
  'POST /api/v1/mandalas/:id/unlike': 'D',
  'POST /api/v1/mandalas/:id/retry-pipeline': 'D',
  'PATCH /api/v1/mandalas/:id': 'D',
  'PATCH /api/v1/mandalas/:id/levels': 'D',
  'DELETE /api/v1/mandalas/:id': 'D',
  'POST /api/v1/playlists/import': 'D',
  'DELETE /api/v1/playlists/:id': 'D',
  'PATCH /api/v1/playlists/:id/title': 'D',
  'PATCH /api/v1/playlists/:id/pause': 'D',
  'PATCH /api/v1/playlists/:id/resume': 'D',
  'POST /api/v1/videos/:id/notes': 'D',
  'PATCH /api/v1/videos/:id/notes/rich': 'D',
  'PATCH /api/v1/settings': 'D',
  'PATCH /api/v1/settings/youtube': 'D',
  'DELETE /api/v1/settings/data': 'D',
  'POST /api/v1/auth/logout': 'D',
};

/**
 * Resolve the cost tier for a route. Returns undefined for unmatched
 * routes (health, public assets, etc.) — those bypass rate limiting.
 */
export function getTierForRoute(method: string, routerPath: string): CostTier | undefined {
  const key = `${method.toUpperCase()} ${routerPath}`;
  return ENDPOINT_TIERS[key];
}
