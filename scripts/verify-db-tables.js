#!/usr/bin/env node
/**
 * verify-db-tables.js — Post-migration table verification
 *
 * Compares Prisma schema models (public schema) against actual DB tables.
 * Exits with code 1 if any tables are missing.
 *
 * Usage: node scripts/verify-db-tables.js
 * Requires: DATABASE_URL or DIRECT_URL environment variable
 *
 * Why: prisma db push fails transactionally when auth-owned tables block it,
 * silently skipping ALL new public tables. This script catches that.
 * See: troubleshooting.md "raw SQL 테이블 생성 → Prisma 스키마 미포함"
 */

const fs = require('fs');
const path = require('path');

async function main() {
  // 1. Parse schema.prisma for public schema models
  const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
  const schema = fs.readFileSync(schemaPath, 'utf-8');

  const expectedTables = [];
  const modelBlocks = schema.split(/^model\s+/m).slice(1);

  for (const block of modelBlocks) {
    const nameMatch = block.match(/^(\w+)/);
    if (!nameMatch) continue;

    const modelName = nameMatch[1];
    const blockContent = block.substring(0, block.indexOf('}') + 1);

    // Only public schema models
    if (!blockContent.includes('@@schema("public")')) continue;

    // Check for @@map override
    const mapMatch = blockContent.match(/@@map\("(\w+)"\)/);
    const tableName = mapMatch ? mapMatch[1] : modelName;

    expectedTables.push(tableName);
  }

  console.log(`Schema defines ${expectedTables.length} public tables`);

  // 2. Query actual DB tables
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();

  try {
    const rows = await db.$queryRawUnsafe(`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `);
    const actualTables = new Set(rows.map((r) => r.tablename));

    // 3. Compare
    const missing = expectedTables.filter((t) => !actualTables.has(t));

    if (missing.length === 0) {
      console.log('All public tables verified on database.');
      process.exit(0);
    }

    console.error(`\nMISSING ${missing.length} TABLE(S) ON DATABASE:`);
    for (const t of missing) {
      console.error(`  - ${t}`);
    }
    console.error(
      '\nThis usually means prisma db push failed silently due to auth table ownership.'
    );
    console.error('Fix: create missing tables manually via raw SQL, then re-run this check.');
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error('Verification script failed:', e.message);
  process.exit(1);
});
