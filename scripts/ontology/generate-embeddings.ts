/**
 * Batch Embedding Generator — ontology.nodes → ontology.embeddings
 *
 * Generates Gemini text-embedding-004 embeddings for all ontology nodes.
 * Idempotent: skips nodes with unchanged content (text_hash check).
 *
 * Usage: npx tsx scripts/ontology/generate-embeddings.ts [--type resource] [--limit 50]
 *
 * Issue: #167 (M12: Intelligence Pipeline)
 */

import { PrismaClient } from '@prisma/client';
import { batchEmbedNodes } from '../../src/modules/ontology/embedding';
import dotenv from 'dotenv';

dotenv.config();

const USER_ID = '0192fedf-85f4-47ab-a652-7fdd116e2b39';

async function main() {
  const args = process.argv.slice(2);
  const typeIdx = args.indexOf('--type');
  const limitIdx = args.indexOf('--limit');

  const typeFilter = typeIdx >= 0 ? args[typeIdx + 1] : undefined;
  const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1]!) : 100;

  const prisma = new PrismaClient();

  try {
    await prisma.$connect();

    // Show current stats
    const stats = await prisma.$queryRaw<{ type: string; total: bigint; embedded: bigint }[]>`
      SELECT
        n.type,
        count(n.id) AS total,
        count(e.id) AS embedded
      FROM ontology.nodes n
      LEFT JOIN ontology.embeddings e ON e.node_id = n.id
      WHERE n.user_id = ${USER_ID}::uuid
      GROUP BY n.type
      ORDER BY total DESC
    `;

    console.log('Current embedding coverage:');
    for (const row of stats) {
      console.log(`  ${row.type}: ${row.embedded}/${row.total}`);
    }
    console.log();

    console.log(`Embedding up to ${limit} nodes${typeFilter ? ` (type: ${typeFilter})` : ''}...`);
    console.log('Rate limit: ~5 req/sec (200ms delay)\n');

    const result = await batchEmbedNodes(USER_ID, {
      limit,
      typeFilter,
      delayMs: 200,
    });

    console.log(`\nResults: ${result.embedded} embedded, ${result.skipped} skipped, ${result.errors} errors`);

    // Show updated stats
    const updatedStats = await prisma.$queryRaw<{ total: bigint; embedded: bigint }[]>`
      SELECT
        (SELECT count(*) FROM ontology.nodes WHERE user_id = ${USER_ID}::uuid) AS total,
        (SELECT count(*) FROM ontology.embeddings e JOIN ontology.nodes n ON n.id = e.node_id WHERE n.user_id = ${USER_ID}::uuid) AS embedded
    `;

    if (updatedStats[0]) {
      const pct = Number(updatedStats[0].total) > 0
        ? (Number(updatedStats[0].embedded) / Number(updatedStats[0].total) * 100).toFixed(1)
        : '0.0';
      console.log(`\nCoverage: ${updatedStats[0].embedded}/${updatedStats[0].total} (${pct}%)`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
