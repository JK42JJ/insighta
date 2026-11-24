/** Shared by the morning-pages scripts: staging-only URL guard and argument helpers. */

/** STG_DIRECT_URL, refused unless it names the staging project (same check as deploy.yml). */
export function stagingUrl(): string {
  const url = process.env['STG_DIRECT_URL'];
  const ref = process.env['STG_PROJECT_REF'];
  if (!url || !ref) throw new Error('STG_DIRECT_URL and STG_PROJECT_REF are required');
  if (!url.includes(`postgres.${ref}:`)) {
    throw new Error(`STG_DIRECT_URL does not name project ${ref}; refusing`);
  }
  return url;
}

/** Print an error with the URL scrubbed, then exit 1. */
export function fail(e: unknown): never {
  const url = process.env['STG_DIRECT_URL'];
  let msg = e instanceof Error ? e.message : String(e);
  if (url) msg = msg.split(url).join('[redacted]');
  console.error(`error: ${msg}`);
  process.exit(1);
}
