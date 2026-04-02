#!/usr/bin/env npx tsx
/**
 * Seed explore templates from V3 JSONL dataset.
 *
 * Usage:
 *   npx tsx scripts/data/seed-explore-templates.ts <path-to-jsonl> [--ci] [--dry-run]
 *
 * Flags:
 *   --ci       CI mode: non-interactive, exit 1 on failure
 *   --dry-run  Count inserts without writing to DB
 *
 * V3 JSONL format:
 *   { center_goal, domain, sub_goals[], actions: { [sub_goal]: string[] }, language }
 */

import { PrismaClient } from '@prisma/client';
import { nanoid } from 'nanoid';
import * as fs from 'fs';
import * as readline from 'readline';
import * as crypto from 'crypto';

// Standalone Prisma client — avoids config/index.ts full env validation
let prisma: PrismaClient | null = null;
function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

// System user for template ownership
const SYSTEM_TEMPLATE_USER_ID = '00000000-0000-0000-0000-000000000001';

// CLI flags
const CI_MODE = process.argv.includes('--ci');
const DRY_RUN = process.argv.includes('--dry-run');

// Map Korean domain labels → internal slug
const DOMAIN_LABEL_TO_SLUG: Record<string, string> = {
  // Korean
  '기술/개발': 'tech',
  '학습/교육': 'learning',
  '건강/피트니스': 'health',
  '비즈니스/커리어': 'business',
  '비즈니스': 'business',
  '재테크/투자': 'finance',
  '인간관계/커뮤니티': 'social',
  '인간관계': 'social',
  '창작/예술': 'creative',
  '라이프스타일/여행': 'lifestyle',
  '라이프스타일': 'lifestyle',
  '마인드/영성': 'mind',
  '마인드': 'mind',
  // English
  'Tech/Development': 'tech',
  'Learning/Education': 'learning',
  'Health/Fitness': 'health',
  'Business/Career': 'business',
  'Finance/Investment': 'finance',
  'Relationships/Community': 'social',
  'Creative/Arts': 'creative',
  'Lifestyle/Travel': 'lifestyle',
  'Mind/Spirituality': 'mind',
};

interface V3Entry {
  center_goal: string;
  center_label?: string;
  domain: string;
  sub_goals: string[];
  sub_labels?: string[];
  actions: Record<string, string[]>;
  language?: string;
}

async function ensureSystemUser() {
  const prisma = getPrisma();

  const existing = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM auth.users WHERE id = $1::uuid`,
    SYSTEM_TEMPLATE_USER_ID
  );

  if (existing.length === 0) {
    console.log('Creating system template user...');
    await prisma.$executeRawUnsafe(
      `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, is_anonymous)
       VALUES ($1::uuid, '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated', 'system-templates@insighta.one', '', NOW(), NOW(), NOW(), false)
       ON CONFLICT (id) DO NOTHING`,
      SYSTEM_TEMPLATE_USER_ID
    );
    console.log('System user created.');
  }
}

interface SeedResult {
  inserted: number;
  skipped: number;
  errors: number;
}

interface ParsedEntry {
  entry: V3Entry;
  domainSlug: string;
  dedupKey: string;
}

async function seedFromJsonl(filePath: string): Promise<SeedResult> {
  const prisma = getPrisma();

  // Phase 1: Parse all JSONL entries
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  const parsed: ParsedEntry[] = [];
  let errors = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;
    let entry: V3Entry;
    try {
      entry = JSON.parse(line);
    } catch {
      console.warn('Invalid JSON, skipping line');
      errors++;
      continue;
    }
    const domainSlug = DOMAIN_LABEL_TO_SLUG[entry.domain];
    if (!domainSlug) {
      console.warn(`Unknown domain "${entry.domain}", skipping: ${entry.center_goal}`);
      errors++;
      continue;
    }
    const lang = entry.language ?? 'null';
    parsed.push({ entry, domainSlug, dedupKey: `${entry.center_goal}||${domainSlug}||${lang}` });
  }

  console.log(`  Parsed ${parsed.length} entries from JSONL (${errors} parse errors)`);

  if (DRY_RUN) {
    console.log(`\n[DRY-RUN] Seed complete: ${parsed.length} would insert, 0 skipped, ${errors} errors`);
    return { inserted: parsed.length, skipped: 0, errors };
  }

  // Phase 2: Pre-fetch existing templates in one query (dedup)
  const existingRows = await prisma.$queryRawUnsafe<{ title: string; domain: string; language: string | null }[]>(
    `SELECT title, domain, language FROM user_mandalas
     WHERE is_template = true AND user_id = $1::uuid`,
    SYSTEM_TEMPLATE_USER_ID,
  );
  const existingKeys = new Set(
    existingRows.map((r) => `${r.title}||${r.domain}||${r.language ?? 'null'}`),
  );
  console.log(`  Existing templates in DB: ${existingKeys.size}`);

  const newEntries = parsed.filter((p) => !existingKeys.has(p.dedupKey));
  const skipped = parsed.length - newEntries.length;
  console.log(`  New to insert: ${newEntries.length}, skipped (existing): ${skipped}`);

  if (newEntries.length === 0) {
    console.log('\nSeed complete: 0 inserted, all already exist');
    return { inserted: 0, skipped, errors };
  }

  // Phase 3: Bulk insert using createMany (3 round trips total)
  // Pre-generate all UUIDs so we can set FK references without round trips

  // 3a. Prepare mandala + level data with pre-generated IDs
  type MandalaRow = { id: string; user_id: string; title: string; is_default: boolean; is_public: boolean; is_template: boolean; domain: string; language: string | null; share_slug: string; position: number };
  type LevelRow = { id: string; mandala_id: string; level_key: string; center_goal: string; center_label: string | null; subjects: string[]; subject_labels: string[]; depth: number; position: number; parent_level_id: string | null; color: string };

  const mandalaRows: MandalaRow[] = [];
  const rootLevelRows: LevelRow[] = [];
  const subLevelRows: LevelRow[] = [];

  for (const { entry, domainSlug } of newEntries) {
    const mandalaId = crypto.randomUUID();
    const rootLevelId = crypto.randomUUID();
    const subjects = entry.sub_goals.slice(0, 8);

    mandalaRows.push({
      id: mandalaId,
      user_id: SYSTEM_TEMPLATE_USER_ID,
      title: entry.center_goal,
      is_default: false,
      is_public: true,
      is_template: true,
      domain: domainSlug,
      language: entry.language ?? null,
      share_slug: nanoid(12),
      position: 0,
    });

    rootLevelRows.push({
      id: rootLevelId,
      mandala_id: mandalaId,
      level_key: 'root',
      center_goal: entry.center_goal,
      center_label: entry.center_label ?? null,
      subjects,
      subject_labels: entry.sub_labels?.slice(0, 8) ?? [],
      depth: 0,
      position: 0,
      parent_level_id: null,
      color: '',
    });

    for (let j = 0; j < Math.min(subjects.length, 8); j++) {
      const subGoal = subjects[j]!;
      const actions = entry.actions[subGoal] ?? [];
      const cleanActions = actions.slice(0, 8).map((a) => a.replace(/\[HIGH\]\s*/g, ''));

      subLevelRows.push({
        id: crypto.randomUUID(),
        mandala_id: mandalaId,
        level_key: `sub-${j}`,
        center_goal: subGoal,
        center_label: entry.sub_labels?.[j] ?? null,
        subjects: cleanActions,
        subject_labels: [],
        depth: 1,
        position: j,
        parent_level_id: rootLevelId,
        color: '',
      });
    }
  }

  // 3b. Bulk insert in chunks (Supabase Cloud has statement_timeout ~120s)
  const CHUNK = 200;

  async function bulkInsertChunked<T>(label: string, rows: T[], fn: (chunk: T[]) => Promise<unknown>) {
    console.log(`  Inserting ${rows.length} ${label}...`);
    for (let c = 0; c < rows.length; c += CHUNK) {
      await fn(rows.slice(c, c + CHUNK));
      if (rows.length > CHUNK) console.log(`    ${label}: ${Math.min(c + CHUNK, rows.length)}/${rows.length}`);
    }
  }

  await bulkInsertChunked('mandalas', mandalaRows, (chunk) =>
    prisma.user_mandalas.createMany({ data: chunk, skipDuplicates: true })
  );
  await bulkInsertChunked('root levels', rootLevelRows, (chunk) =>
    prisma.user_mandala_levels.createMany({ data: chunk, skipDuplicates: true })
  );
  await bulkInsertChunked('sub levels', subLevelRows, (chunk) =>
    prisma.user_mandala_levels.createMany({ data: chunk, skipDuplicates: true })
  );

  const inserted = mandalaRows.length;

  console.log(`\nSeed complete: ${inserted} inserted, ${skipped} skipped, ${errors} errors`);
  return { inserted, skipped, errors };
}

async function postSeedValidation(jsonlPath: string): Promise<boolean> {
  console.log('\n=== Post-Seed Validation ===');
  const prisma = getPrisma();
  let pass = true;

  // 1. Count JSONL entries by language
  const jsonlCounts: Record<string, number> = {};
  const fileStream = fs.createReadStream(jsonlPath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    const lang = entry.language ?? 'null';
    jsonlCounts[lang] = (jsonlCounts[lang] ?? 0) + 1;
  }

  // 2. Count DB entries by language
  const dbRows = await prisma.$queryRawUnsafe<{ language: string | null; count: bigint }[]>(
    `SELECT language, count(*) as count FROM user_mandalas
     WHERE is_template = true AND user_id = $1::uuid
     GROUP BY language`,
    SYSTEM_TEMPLATE_USER_ID,
  );
  const dbCounts: Record<string, number> = {};
  for (const row of dbRows) {
    dbCounts[row.language ?? 'null'] = Number(row.count);
  }

  // 3. Verify: JSONL count <= DB count for each language
  for (const [lang, jsonlCount] of Object.entries(jsonlCounts)) {
    const dbCount = dbCounts[lang] ?? 0;
    if (dbCount < jsonlCount) {
      console.error(`  [FAIL] ${lang}: JSONL=${jsonlCount}, DB=${dbCount} (missing ${jsonlCount - dbCount})`);
      pass = false;
    } else {
      console.log(`  [OK]   ${lang}: JSONL=${jsonlCount}, DB=${dbCount}`);
    }
  }

  // 4. Check for duplicates in DB
  const dupes = await prisma.$queryRawUnsafe<{ cnt: bigint }[]>(
    `SELECT count(*) as cnt FROM (
       SELECT title, domain, language FROM user_mandalas
       WHERE is_template = true AND user_id = $1::uuid
       GROUP BY title, domain, language HAVING count(*) > 1
     ) d`,
    SYSTEM_TEMPLATE_USER_ID,
  );
  const dupeCount = Number(dupes[0]?.cnt ?? 0);
  if (dupeCount > 0) {
    console.error(`  [FAIL] ${dupeCount} duplicate title+domain+language groups found`);
    pass = false;
  } else {
    console.log('  [OK]   No duplicates');
  }

  console.log(pass ? '\n[PASS] Validation complete.' : '\n[FAIL] Validation failed.');
  return pass;
}

async function main() {
  const args = process.argv.filter((a) => !a.startsWith('--'));
  const jsonlPath = args[2];

  if (!jsonlPath) {
    console.error(
      'Usage: npx tsx scripts/data/seed-explore-templates.ts <path-to-jsonl> [--ci] [--dry-run]',
    );
    process.exit(1);
  }

  if (!fs.existsSync(jsonlPath)) {
    console.error(`File not found: ${jsonlPath}`);
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('[DRY-RUN] No data will be written to DB.\n');
  }
  if (CI_MODE) {
    console.log('[CI] Running in non-interactive mode.\n');
  }

  if (!DRY_RUN) {
    await ensureSystemUser();
  }
  const result = await seedFromJsonl(jsonlPath);

  // CI mode: exit 1 if errors > 10% of total
  if (CI_MODE && result.errors > 0) {
    const total = result.inserted + result.skipped + result.errors;
    const errorRate = result.errors / total;
    if (errorRate > 0.1) {
      console.error(`[CI] Error rate ${(errorRate * 100).toFixed(1)}% exceeds 10% threshold.`);
      process.exit(1);
    }
  }

  // Post-seed validation (skip in dry-run)
  if (!DRY_RUN) {
    const validationOk = await postSeedValidation(jsonlPath);
    if (!validationOk && CI_MODE) {
      process.exit(1);
    }
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
