/**
 * seed-trend-data — CP357 onboarding data seed
 *
 * Runs the trend pipeline (Layer 1 + Layer 2) end-to-end so dev environments
 * have keyword_scores populated. Without this, video-discover (Layer 3) finds
 * 0 keywords to match against mandala embeddings and skips silently.
 *
 * Order matters: trend-collector must complete before iks-scorer because
 * iks-scorer reads from trend_signals.
 *
 * Usage:
 *   npx tsx scripts/seed-trend-data.ts
 *
 * Optional env:
 *   YOUTUBE_API_KEY  — required by trend-collector (loaded from .env / .env.local)
 *   DATABASE_URL     — required by both (loaded from .env)
 *
 * Exit codes:
 *   0 = both stages succeeded
 *   1 = trend-collector failed (no signals = nothing to score)
 *   2 = iks-scorer failed (signals exist but scores not generated)
 */

import { spawn } from 'child_process';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '..');

function runScript(scriptName: string): Promise<number> {
  return new Promise((resolve) => {
    console.log(`\n=== ${scriptName} ===`);
    const proc = spawn('npx', ['tsx', `scripts/${scriptName}`], {
      cwd: REPO_ROOT,
      stdio: 'inherit',
      env: process.env,
    });
    proc.on('exit', (code) => resolve(code ?? 1));
    proc.on('error', (err) => {
      console.error(`Failed to launch ${scriptName}:`, err);
      resolve(1);
    });
  });
}

async function main() {
  console.log('CP357 seed-trend-data — populating keyword_scores for dev video-discover');

  const collectorExit = await runScript('run-trend-collector.ts');
  if (collectorExit !== 0) {
    console.error(`\n[X] trend-collector exited with ${collectorExit} — aborting`);
    process.exit(1);
  }

  const scorerExit = await runScript('run-iks-scorer.ts');
  if (scorerExit !== 0) {
    console.error(`\n[X] iks-scorer exited with ${scorerExit} — keyword_scores incomplete`);
    process.exit(2);
  }

  console.log('\n[OK] seed complete. video-discover should now produce recommendations.');
  console.log('     Next: create a mandala (or toggle video_discover ON for an existing one).');
}

main().catch((err) => {
  console.error('seed-trend-data crashed:', err);
  process.exit(1);
});
