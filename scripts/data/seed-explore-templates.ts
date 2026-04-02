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

async function seedFromJsonl(filePath: string): Promise<SeedResult> {
  const prisma = getPrisma();
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let inserted = 0;
  let skipped = 0;
  let errors = 0;

  for await (const line of rl) {
    if (!line.trim()) continue;

    let entry: V3Entry;
    try {
      entry = JSON.parse(line);
    } catch {
      console.warn(`Invalid JSON, skipping line`);
      errors++;
      continue;
    }

    const domainSlug = DOMAIN_LABEL_TO_SLUG[entry.domain];

    if (!domainSlug) {
      console.warn(`Unknown domain "${entry.domain}", skipping: ${entry.center_goal}`);
      errors++;
      continue;
    }

    if (DRY_RUN) {
      inserted++;
      if (inserted % 100 === 0) console.log(`  [dry-run] ... ${inserted} would insert`);
      continue;
    }

    // Idempotent dedup: center_goal + domain + language (all 3 fields)
    const lang = entry.language ?? null;
    const existing = await prisma.user_mandalas.findFirst({
      where: {
        user_id: SYSTEM_TEMPLATE_USER_ID,
        title: entry.center_goal,
        domain: domainSlug,
        language: lang,
        is_template: true,
      },
      select: { id: true },
    });
    if (existing) {
      skipped++;
      continue;
    }

    const mandala = await prisma.user_mandalas.create({
      data: {
        user_id: SYSTEM_TEMPLATE_USER_ID,
        title: entry.center_goal,
        is_default: false,
        is_public: true,
        is_template: true,
        domain: domainSlug,
        language: entry.language ?? null,
        share_slug: nanoid(12),
      },
      select: { id: true },
    });

    // Root level (depth=0): center_goal + sub_goals + labels
    const rootLevel = await prisma.user_mandala_levels.create({
      data: {
        mandala_id: mandala.id,
        level_key: 'root',
        center_goal: entry.center_goal,
        center_label: entry.center_label ?? null,
        subjects: entry.sub_goals.slice(0, 8),
        subject_labels: entry.sub_labels?.slice(0, 8) ?? [],
        depth: 0,
        position: 0,
      },
    });

    // Sub-levels (depth=1): each sub_goal + its actions
    for (let i = 0; i < Math.min(entry.sub_goals.length, 8); i++) {
      const subGoal = entry.sub_goals[i]!;
      const actions = entry.actions[subGoal] ?? [];

      // Clean [HIGH] tags from action text
      const cleanActions = actions
        .slice(0, 8)
        .map((a) => a.replace(/\[HIGH\]\s*/g, ''));

      const subLabel = entry.sub_labels?.[i] ?? null;
      await prisma.user_mandala_levels.create({
        data: {
          mandala_id: mandala.id,
          level_key: `sub-${i}`,
          center_goal: subGoal,
          center_label: subLabel,
          subjects: cleanActions,
          depth: 1,
          position: i,
          parent_level_id: rootLevel.id,
        },
      });
    }

    inserted++;
    if (inserted % 50 === 0) {
      console.log(`  ... ${inserted} inserted`);
    }
  }

  const mode = DRY_RUN ? '[DRY-RUN] ' : '';
  console.log(`\n${mode}Seed complete: ${inserted} inserted, ${skipped} skipped, ${errors} errors`);

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
