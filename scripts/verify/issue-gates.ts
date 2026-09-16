/**
 * Run the publish gates against an issue document, with the resolver wired to
 * the live API so "this video exists" is answered by YouTube rather than by
 * the draft that claims it.
 *
 *   npx tsx scripts/verify/issue-gates.ts <path-to-issue.json>
 */

import { readFileSync } from 'node:fs';
import { IssueDocumentSchema, findUngroundedClaims } from '@/modules/newsletter/issue-schema';
import { runPublishGates } from '@/modules/newsletter/publish-gates';
import { createVideoResolver } from '@/modules/newsletter/video-resolver';

async function main(): Promise<void> {
  // One resolver implementation, shared with the publish route. This script
  // used to carry a private copy, which is how the server ended up with none.
  const resolver = createVideoResolver();
  if (!resolver) throw new Error('no YouTube API key configured');

  const path = process.argv[2];
  if (!path) throw new Error('usage: issue-gates.ts <issue.json>');

  const parsed = IssueDocumentSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed.success) {
    console.log('FAIL  schema');
    for (const i of parsed.error.issues.slice(0, 10)) {
      console.log(`      ${i.path.join('.')}: ${i.message}`);
    }
    process.exit(1);
  }
  const doc = parsed.data;
  console.log(`PASS  schema  (${doc.slug}, locale ${doc.locale})`);

  const ungrounded = findUngroundedClaims(doc);
  console.log(
    ungrounded.length === 0
      ? 'PASS  every graded claim carries a reference'
      : `FAIL  ${ungrounded.length} ungrounded claim(s)`
  );
  for (const u of ungrounded) console.log(`      ${u}`);

  const report = await runPublishGates(doc, resolver);
  console.log(
    report.passed
      ? `PASS  publish gates  (${report.checked.picks} picks, ` +
          `${report.checked.gradedClaims} graded claims, ${report.checked.citedRefs} cited refs)`
      : `FAIL  ${report.failures.length} gate failure(s)`
  );
  for (const f of report.failures) console.log(`      [${f.gate}] ${f.where}: ${f.detail}`);

  const ok = ungrounded.length === 0 && report.passed;
  console.log(ok ? '\n=== ready to publish ===' : '\n=== NOT ready ===');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
