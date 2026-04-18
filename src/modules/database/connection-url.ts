/**
 * Prisma connection URL helpers.
 *
 * Prod's DATABASE_URL is pinned to `connection_limit=1` because it points
 * at Supabase's Transaction Mode pooler (port 6543) and the config file
 * was written before Prisma documented that a small handful of connections
 * (rather than 1) is also safe with `pgbouncer=true`. A pool of 1 means any
 * two concurrent requests serialize; the second hits the default 10s
 * Prisma `pool_timeout` and throws `P2024`. Observed in prod 2026-04-16:
 * `POST /mandalas/create-with-data` returning 500 on ~17% of requests, and
 * the wizard "Go → dashboard" showing a ~10s hang.
 *
 * Rather than editing the (CP358-protected) .env file, we transform the URL
 * at PrismaClient construction time — replacing `connection_limit=N` with a
 * value read from `PRISMA_POOL_LIMIT` (default 5). Safe for both pgbouncer
 * transaction mode and direct connections; `pgbouncer=true` keeps prepared
 * statement caching disabled so the extra connections don't collide on
 * server-side statement names.
 */

export const DEFAULT_POOL_LIMIT = 5;
/** Absolute ceiling — guards against a typo like `PRISMA_POOL_LIMIT=500`. */
export const MAX_POOL_LIMIT = 50;

/**
 * Read the pool size from env, falling back to DEFAULT_POOL_LIMIT if unset
 * or out of range. Accepts [1, MAX_POOL_LIMIT].
 */
export function getPoolLimit(
  envVal: string | undefined = process.env['PRISMA_POOL_LIMIT']
): number {
  if (!envVal) return DEFAULT_POOL_LIMIT;
  const parsed = Number.parseInt(envVal, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_POOL_LIMIT;
  if (parsed < 1 || parsed > MAX_POOL_LIMIT) return DEFAULT_POOL_LIMIT;
  return parsed;
}

/**
 * Rewrite `connection_limit` in a Postgres connection URL to the given
 * value. If the URL already has `connection_limit=N`, replace it. If not,
 * append it using the correct separator (`?` when there is no query string
 * yet, `&` otherwise). Returns empty input unchanged.
 */
export function buildConnectionUrl(rawUrl: string | undefined, poolLimit: number): string {
  let url = rawUrl ?? '';
  if (!url) return url;

  // Auto-add pgbouncer=true when URL points at Supabase transaction-mode
  // pooler (port 6543). Prisma caches prepared statements by name per
  // connection; pgbouncer's transaction mode rotates the underlying pg
  // connection per txn, so statement names resolve to gone-connections
  // and queries fail with `26000: prepared statement "sNN" does not
  // exist`. Observed in prod 2026-04-18 after password rotation when
  // the new secret omitted the flag. Safe to add at construction time
  // regardless of whether the user already included it — regex below
  // checks first.
  if (/:6543\//.test(url) && !/[?&]pgbouncer=/.test(url)) {
    const sep = url.includes('?') ? '&' : '?';
    url = `${url}${sep}pgbouncer=true`;
  }

  if (/[?&]connection_limit=\d+/.test(url)) {
    return url.replace(/([?&]connection_limit=)\d+/, `$1${poolLimit}`);
  }
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}connection_limit=${poolLimit}`;
}
