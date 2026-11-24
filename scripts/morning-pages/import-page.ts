/**
 * Import one morning page (JSON) into public.morning_pages. STAGING ONLY.
 *
 *   STG_DIRECT_URL=... STG_PROJECT_REF=... npx tsx scripts/morning-pages/import-page.ts \
 *     --file page.json --user-email someone@example.com [--write]
 *
 * Default is a preview: nothing is written. --write upserts the row and reads it back.
 * The URL is refused unless it names the staging project (same check as deploy.yml). The URL and
 * password are never printed. With hide-page.ts / unhide-page.ts this is a writer of morning_pages;
 * a re-import never clears hidden_at / hidden_reason (a withdrawn brief stays withdrawn).
 */
import { readFileSync } from 'fs';
import { isDeepStrictEqual } from 'util';
import { PrismaClient } from '@prisma/client';
import { validatePage, type Page } from '../../src/modules/morning-feed/pages';
import { UPSERT_PAGE_SQL } from '../../src/modules/morning-feed/pages-hide';

interface Args {
  file: string;
  email: string;
  write: boolean;
}

function parseArgs(argv: string[]): Args {
  let file = '';
  let email = '';
  let write = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--file') file = argv[++i] ?? '';
    else if (a === '--user-email') email = argv[++i] ?? '';
    else if (a === '--write') write = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!file || !email) throw new Error('usage: --file <json> --user-email <email> [--write]');
  return { file, email, write };
}

function stagingUrl(): string {
  const url = process.env['STG_DIRECT_URL'];
  const ref = process.env['STG_PROJECT_REF'];
  if (!url || !ref) throw new Error('STG_DIRECT_URL and STG_PROJECT_REF are required');
  if (!url.includes(`postgres.${ref}:`)) {
    throw new Error(`STG_DIRECT_URL does not name project ${ref}; refusing`);
  }
  return url;
}

interface ExistingRow {
  headline: string;
  core: unknown;
  note: unknown;
  videos: unknown;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const url = stagingUrl();
  const page: Page = validatePage(JSON.parse(readFileSync(args.file, 'utf8')));
  const db = new PrismaClient({ datasourceUrl: url });
  try {
    const users = await db.$queryRawUnsafe<Array<{ id: string; email: string }>>(
      `SELECT id::text AS id, email FROM auth.users WHERE lower(email) = lower($1)`,
      args.email
    );
    const user = users[0];
    if (!user) throw new Error('no user with that email in auth.users; stopping');

    const tables = await db.$queryRawUnsafe<Array<{ ok: boolean }>>(
      `SELECT to_regclass('public.morning_pages') IS NOT NULL AS ok`
    );
    const tableReady = !!tables[0]?.ok;
    const existing = tableReady
      ? await db.$queryRawUnsafe<ExistingRow[]>(
          `SELECT headline, core, note, videos FROM public.morning_pages
            WHERE user_id = $1::uuid AND cell = $2 AND seen_date = $3::date`,
          user.id,
          page.domain,
          page.seen_date
        )
      : [];
    console.log(`mode:        ${args.write ? 'WRITE' : 'preview (no write)'}`);
    console.log(`user:        ${user.id} <${user.email}>`);
    console.log(`domain:      ${page.domain}`);
    console.log(`seen_date:   ${page.seen_date}`);
    console.log(`headline:    ${page.headline}`);
    const paragraphs = new Set(page.core.map((c) => c.para).filter((n) => n !== undefined)).size;
    console.log(
      `counts:      core=${page.core.length} note_sections=${page.note.length} videos=${page.videos.length}` +
        (paragraphs > 0 ? ` paragraphs=${paragraphs}` : '')
    );
    console.log(
      !tableReady
        ? 'existing:    table public.morning_pages not created yet (the stg deploy creates it)'
        : existing[0]
          ? `existing:    YES, will be overwritten (headline: ${existing[0].headline})`
          : 'existing:    no (new row)'
    );
    if (args.write && !tableReady) {
      throw new Error('public.morning_pages does not exist yet; deploy first, then --write');
    }
    if (!args.write) {
      console.log('preview only; re-run with --write to apply');
      return;
    }

    // UPSERT_PAGE_SQL leaves hidden_at / hidden_reason alone: a hidden page stays hidden
    await db.$executeRawUnsafe(
      UPSERT_PAGE_SQL,
      user.id,
      page.domain,
      page.seen_date,
      page.headline,
      JSON.stringify(page.core),
      JSON.stringify(page.note),
      JSON.stringify(page.videos)
    );
    const back = await db.$queryRawUnsafe<ExistingRow[]>(
      `SELECT headline, core, note, videos FROM public.morning_pages
        WHERE user_id = $1::uuid AND cell = $2 AND seen_date = $3::date`,
      user.id,
      page.domain,
      page.seen_date
    );
    const r = back[0];
    const ok =
      !!r &&
      r.headline === page.headline &&
      isDeepStrictEqual(r.core, page.core) &&
      isDeepStrictEqual(r.note, page.note) &&
      isDeepStrictEqual(r.videos, page.videos);
    console.log(ok ? 'written; read-back matches' : 'WRITTEN BUT READ-BACK DOES NOT MATCH');
    if (!ok) process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}

main().catch((e: unknown) => {
  const url = process.env['STG_DIRECT_URL'];
  let msg = e instanceof Error ? e.message : String(e);
  if (url) msg = msg.split(url).join('[redacted]');
  console.error(`error: ${msg}`);
  process.exit(1);
});
