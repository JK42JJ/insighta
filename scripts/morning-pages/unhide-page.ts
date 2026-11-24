/**
 * Bring a withdrawn brief back: clear hidden_at and hidden_reason (decision R40 option a,
 * 2026-11-24). STAGING ONLY.
 *
 *   STG_DIRECT_URL=... STG_PROJECT_REF=... npx tsx scripts/morning-pages/unhide-page.ts \
 *     --date 2026-11-23 --cell "기술/개발" [--user-email a@b.c] [--write]
 *
 * Default is a preview: prints the matching rows, writes nothing. --write clears the hidden state
 * and prints the rows again. Without --user-email every owner's row of that (cell, date) matches.
 */
import { PrismaClient } from '@prisma/client';
import { readHiddenState, unhidePages } from '../../src/modules/morning-feed/pages-hide';
import { fail, stagingUrl } from './_stg';

function parseArgs(argv: string[]) {
  const a = { date: '', cell: '', email: '', write: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--date') a.date = argv[++i] ?? '';
    else if (k === '--cell') a.cell = argv[++i] ?? '';
    else if (k === '--user-email') a.email = argv[++i] ?? '';
    else if (k === '--write') a.write = true;
    else throw new Error(`unknown argument: ${k}`);
  }
  if (!a.date || !a.cell) {
    throw new Error('usage: --date <YYYY-MM-DD> --cell <cell> [--user-email <e>] [--write]');
  }
  return a;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = new PrismaClient({ datasourceUrl: stagingUrl() });
  try {
    let userId: string | undefined;
    if (args.email) {
      const u = await db.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id::text AS id FROM auth.users WHERE lower(email) = lower($1)`,
        args.email
      );
      if (!u[0]) throw new Error('no user with that email in auth.users; stopping');
      userId = u[0].id;
    }
    const key = { cell: args.cell, date: args.date, userId };
    console.log(`mode:   ${args.write ? 'WRITE' : 'preview (no write)'}`);
    const before = await readHiddenState(db, key);
    console.log('before:', JSON.stringify(before, null, 2));
    if (before.length === 0) throw new Error('no matching page; nothing to unhide');
    if (!args.write) {
      console.log('preview only; re-run with --write to apply');
      return;
    }
    const n = await unhidePages(db, key);
    console.log(`unhidden rows changed: ${n}`);
    console.log('after: ', JSON.stringify(await readHiddenState(db, key), null, 2));
  } finally {
    await db.$disconnect();
  }
}

main().catch(fail);
