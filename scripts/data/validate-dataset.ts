#!/usr/bin/env npx tsx
/**
 * Validate mandala dataset JSONL files.
 *
 * Checks:
 *   1. Schema: required fields, correct types
 *   2. Dedup: no duplicate center_goal+domain+language within file
 *   3. Quality: completeness score per entry
 *
 * Usage:
 *   npx tsx scripts/data/validate-dataset.ts <path-to-jsonl>
 *
 * Exit codes:
 *   0 = all checks pass
 *   1 = validation errors found
 */

import * as fs from 'fs';
import * as readline from 'readline';

const VALID_DOMAINS_KO = [
  '기술/개발',
  '학습/교육',
  '건강/피트니스',
  '비즈니스/커리어',
  '재테크/투자',
  '인간관계/커뮤니티',
  '창작/예술',
  '라이프스타일/여행',
  '마인드/영성',
] as const;

const VALID_DOMAINS_EN = [
  'Tech/Development',
  'Learning/Education',
  'Health/Fitness',
  'Business/Career',
  'Finance/Investment',
  'Relationships/Community',
  'Creative/Arts',
  'Lifestyle/Travel',
  'Mind/Spirituality',
] as const;

const ALL_VALID_DOMAINS: readonly string[] = [...VALID_DOMAINS_KO, ...VALID_DOMAINS_EN];

const REQUIRED_FIELDS = ['center_goal', 'domain', 'sub_goals', 'actions'] as const;
const EXPECTED_SUB_GOALS = 8;
const EXPECTED_ACTIONS_PER_GOAL = 8;

interface ValidationError {
  line: number;
  field: string;
  message: string;
}

interface QualityReport {
  total: number;
  passed: number;
  failed: number;
  duplicates: number;
  avgQualityScore: number;
  domainDistribution: Record<string, number>;
  errors: ValidationError[];
}

function validateEntry(
  entry: Record<string, unknown>,
  lineNum: number,
): { errors: ValidationError[]; qualityScore: number } {
  const errors: ValidationError[] = [];
  let qualityPoints = 0;
  let qualityMax = 0;

  // 1. Required fields
  for (const field of REQUIRED_FIELDS) {
    qualityMax += 1;
    if (!(field in entry) || entry[field] === null || entry[field] === '') {
      errors.push({ line: lineNum, field, message: `Missing required field: ${field}` });
    } else {
      qualityPoints += 1;
    }
  }

  // 2. Domain validation
  qualityMax += 1;
  const domain = entry.domain as string;
  if (domain && !ALL_VALID_DOMAINS.includes(domain)) {
    errors.push({
      line: lineNum,
      field: 'domain',
      message: `Unknown domain: "${domain}"`,
    });
  } else if (domain) {
    qualityPoints += 1;
  }

  // 3. Sub-goals count
  qualityMax += 1;
  const subGoals = entry.sub_goals as string[];
  if (Array.isArray(subGoals)) {
    if (subGoals.length !== EXPECTED_SUB_GOALS) {
      errors.push({
        line: lineNum,
        field: 'sub_goals',
        message: `Expected ${EXPECTED_SUB_GOALS} sub_goals, got ${subGoals.length}`,
      });
    } else {
      qualityPoints += 1;
    }

    // 4. Empty sub-goals check
    const emptySubGoals = subGoals.filter((sg) => !sg || sg.trim() === '');
    if (emptySubGoals.length > 0) {
      errors.push({
        line: lineNum,
        field: 'sub_goals',
        message: `${emptySubGoals.length} empty sub_goal(s)`,
      });
    }
  }

  // 5. Actions completeness
  const actions = entry.actions as Record<string, string[]>;
  if (actions && typeof actions === 'object' && Array.isArray(subGoals)) {
    for (const sg of subGoals) {
      qualityMax += 1;
      const acts = actions[sg];
      if (!acts || !Array.isArray(acts)) {
        errors.push({
          line: lineNum,
          field: 'actions',
          message: `Missing actions for sub_goal: "${sg}"`,
        });
      } else {
        if (acts.length === EXPECTED_ACTIONS_PER_GOAL) {
          qualityPoints += 1;
        } else if (acts.length > 0) {
          qualityPoints += acts.length / EXPECTED_ACTIONS_PER_GOAL;
        }
      }
    }
  }

  // 6. Language field
  qualityMax += 1;
  if (entry.language && typeof entry.language === 'string') {
    qualityPoints += 1;
  }

  const qualityScore = qualityMax > 0 ? qualityPoints / qualityMax : 0;
  return { errors, qualityScore };
}

async function validate(filePath: string): Promise<QualityReport> {
  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  const report: QualityReport = {
    total: 0,
    passed: 0,
    failed: 0,
    duplicates: 0,
    avgQualityScore: 0,
    domainDistribution: {},
    errors: [],
  };

  const seen = new Set<string>();
  let totalQuality = 0;
  let lineNum = 0;

  for await (const line of rl) {
    lineNum++;
    if (!line.trim()) continue;

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      report.errors.push({
        line: lineNum,
        field: 'json',
        message: 'Invalid JSON',
      });
      report.failed++;
      report.total++;
      continue;
    }

    report.total++;

    // Dedup check: center_goal + domain + language
    const dedupKey = `${entry.center_goal}|${entry.domain}|${entry.language ?? ''}`;
    if (seen.has(dedupKey)) {
      report.errors.push({
        line: lineNum,
        field: 'dedup',
        message: `Duplicate: "${entry.center_goal}" in domain "${entry.domain}"`,
      });
      report.duplicates++;
      report.failed++;
      continue;
    }
    seen.add(dedupKey);

    // Validate entry
    const { errors, qualityScore } = validateEntry(entry, lineNum);
    totalQuality += qualityScore;

    if (errors.length > 0) {
      report.errors.push(...errors);
      report.failed++;
    } else {
      report.passed++;
    }

    // Domain distribution
    const domain = (entry.domain as string) || 'unknown';
    report.domainDistribution[domain] = (report.domainDistribution[domain] ?? 0) + 1;
  }

  report.avgQualityScore =
    report.total > 0 ? Math.round((totalQuality / report.total) * 100) / 100 : 0;

  return report;
}

async function main() {
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: npx tsx scripts/data/validate-dataset.ts <path-to-jsonl>');
    process.exit(1);
  }

  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  console.log(`Validating: ${filePath}\n`);
  const report = await validate(filePath);

  // Output report
  console.log('=== Dataset Validation Report ===');
  console.log(`Total:      ${report.total}`);
  console.log(`Passed:     ${report.passed}`);
  console.log(`Failed:     ${report.failed}`);
  console.log(`Duplicates: ${report.duplicates}`);
  console.log(`Quality:    ${report.avgQualityScore}`);
  console.log('');
  console.log('Domain Distribution:');
  for (const [domain, count] of Object.entries(report.domainDistribution).sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`  ${domain}: ${count}`);
  }

  if (report.errors.length > 0) {
    const MAX_ERRORS = 20;
    console.log(`\nErrors (showing first ${MAX_ERRORS}):`);
    for (const err of report.errors.slice(0, MAX_ERRORS)) {
      console.log(`  L${err.line} [${err.field}]: ${err.message}`);
    }
    if (report.errors.length > MAX_ERRORS) {
      console.log(`  ... and ${report.errors.length - MAX_ERRORS} more`);
    }
  }

  // CI-friendly output
  if (report.failed > 0) {
    console.log('\n[FAIL] Validation failed.');
    process.exit(1);
  } else {
    console.log('\n[PASS] All entries valid.');
    process.exit(0);
  }
}

main().catch((err) => {
  console.error('Validation error:', err);
  process.exit(1);
});
