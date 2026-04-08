/**
 * run-auto-add — CP357 verification harness
 *
 * Calls maybeAutoAddRecommendations directly against the local DB so the
 * selective-replace logic can be exercised without going through the full
 * video-discover pipeline (which needs valid OAuth + YouTube quota).
 *
 * Usage:
 *   npx tsx scripts/run-auto-add.ts <user_id> <mandala_id>
 */

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.resolve(process.cwd(), '.env'), override: true });

import { maybeAutoAddRecommendations } from '../src/modules/mandala/auto-add-recommendations';

async function main() {
  const userId = process.argv[2];
  const mandalaId = process.argv[3];
  if (!userId || !mandalaId) {
    console.error('Usage: npx tsx scripts/run-auto-add.ts <user_id> <mandala_id>');
    process.exit(1);
  }

  console.log(`[run-auto-add] user=${userId} mandala=${mandalaId}`);
  const t0 = Date.now();
  const result = await maybeAutoAddRecommendations(userId, mandalaId);
  const wallMs = Date.now() - t0;

  console.log(`[run-auto-add] result (${wallMs}ms):`, JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error('[run-auto-add] crashed:', err);
  process.exit(2);
});
