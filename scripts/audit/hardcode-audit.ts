#!/usr/bin/env tsx
// Enforces CLAUDE.md "하드코딩 + 단편 조치 금지" — fails when any rule
// exceeds its baseline in reports/hardcode-audit/baseline.json.
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

interface RuleDef {
  id: string;
  description: string;
  pattern: string;
  allowedFileGlobs: string[];
  searchGlobs?: string[];
  multiline?: boolean;
}

const REPO_ROOT = resolve(__dirname, '..', '..');
const REPORT_DIR = resolve(REPO_ROOT, 'reports', 'hardcode-audit');
const BASELINE_PATH = resolve(REPORT_DIR, 'baseline.json');

const RULES: RuleDef[] = [
  {
    id: 'ms-per-day-reseclared',
    description: 'MS_PER_DAY / MS_PER_HOUR / MS_PER_MINUTE redeclared outside time-constants',
    pattern: String.raw`^\s*(?:export\s+)?const\s+MS_PER_(?:DAY|HOUR|MINUTE|SECOND)\s*=`,
    allowedFileGlobs: ['src/utils/time-constants.ts'],
  },
  {
    id: 'process-env-direct-read',
    description: 'process.env[...] or process.env.FOO read outside config modules',
    pattern: String.raw`process\.env(?:\[|\.)`,
    allowedFileGlobs: [
      'src/config/**',
      '**/config.ts',
      // Bootstrap files that must read env before config loads
      'src/index.ts',
      'src/server.ts',
      // Scripts and tests legitimately touch process.env
      'scripts/**',
      'src/**/__tests__/**',
      'src/**/*.test.ts',
      'tests/**',
    ],
  },
  {
    id: 'inline-env-parser',
    description: 'Inline env-parser helper declared outside config modules',
    pattern: String.raw`function\s+parse(?:Int|Float|Bool)Env\b`,
    allowedFileGlobs: ['src/config/**', '**/config.ts', 'scripts/**'],
  },
  {
    id: 'raw-ms-per-day-literal',
    description: 'Raw "24 * 60 * 60 * 1000" style literal (use MS_PER_DAY)',
    pattern: String.raw`24\s*\*\s*60\s*\*\s*60\s*\*\s*1000`,
    allowedFileGlobs: ['src/utils/time-constants.ts'],
  },
  {
    id: 'raw-ms-per-hour-literal',
    description: 'Raw "60 * 60 * 1000" style literal (use MS_PER_HOUR)',
    pattern: String.raw`\b60\s*\*\s*60\s*\*\s*1000\b`,
    allowedFileGlobs: ['src/utils/time-constants.ts'],
  },
];

interface RuleResult {
  id: string;
  description: string;
  violationCount: number;
  violations: Array<{ file: string; line: number; text: string }>;
}

function runRg(pattern: string, searchGlobs: string[]): string {
  const globArgs = searchGlobs.map((g) => `--glob '${g}'`).join(' ');
  try {
    const out = execSync(
      `rg --json --line-number -e '${pattern}' ${globArgs} src`,
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        maxBuffer: 32 * 1024 * 1024,
      }
    );
    return out;
  } catch (err) {
    // rg exits 1 when zero matches.
    const execErr = err as { stdout?: Buffer | string; status?: number | null };
    if (execErr.status === 1) return typeof execErr.stdout === 'string' ? execErr.stdout : '';
    throw err;
  }
}

function matchesAnyGlob(file: string, globs: string[]): boolean {
  for (const glob of globs) {
    const re = new RegExp(
      '^' +
        glob
          .replace(/\./g, '\\.')
          .replace(/\*\*/g, '§§')
          .replace(/\*/g, '[^/]*')
          .replace(/§§/g, '.*') +
        '$'
    );
    if (re.test(file)) return true;
  }
  return false;
}

function auditRule(rule: RuleDef): RuleResult {
  const searchGlobs = rule.searchGlobs ?? [
    '!**/__tests__/**',
    '!**/*.test.ts',
    '!**/*.spec.ts',
  ];
  const raw = runRg(rule.pattern, searchGlobs);
  const violations: RuleResult['violations'] = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type !== 'match') continue;
      const filePath = event.data.path.text as string;
      if (matchesAnyGlob(filePath, rule.allowedFileGlobs)) continue;
      const text = (event.data.lines.text as string).trim();
      // Skip hour-literal hits that are part of the day literal (counted separately).
      if (rule.id === 'raw-ms-per-hour-literal' && /\b24\s*\*\s*60\s*\*\s*60\s*\*\s*1000\b/.test(text)) {
        continue;
      }
      violations.push({
        file: filePath,
        line: event.data.line_number as number,
        text,
      });
    } catch {
      // skip non-JSON lines
    }
  }
  return {
    id: rule.id,
    description: rule.description,
    violationCount: violations.length,
    violations,
  };
}

interface AuditReport {
  generatedAt: string;
  gitCommit: string | null;
  rules: RuleResult[];
  totalViolations: number;
}

function currentCommit(): string | null {
  try {
    return execSync('git rev-parse HEAD', { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function loadBaseline(): Record<string, number> | null {
  if (!existsSync(BASELINE_PATH)) return null;
  try {
    return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as Record<string, number>;
  } catch {
    return null;
  }
}

function main(): void {
  const results = RULES.map(auditRule);
  const totalViolations = results.reduce((sum, r) => sum + r.violationCount, 0);
  const report: AuditReport = {
    generatedAt: new Date().toISOString(),
    gitCommit: currentCommit(),
    rules: results,
    totalViolations,
  };

  mkdirSync(REPORT_DIR, { recursive: true });
  const stampedPath = resolve(
    REPORT_DIR,
    `report-${report.generatedAt.replace(/[:]/g, '-')}.json`
  );
  writeFileSync(stampedPath, JSON.stringify(report, null, 2));
  const latestPath = resolve(REPORT_DIR, 'latest.json');
  writeFileSync(latestPath, JSON.stringify(report, null, 2));

  // eslint-disable-next-line no-console
  console.log(`[hardcode-audit] report: ${stampedPath}`);
  for (const r of results) {
    // eslint-disable-next-line no-console
    console.log(`  ${r.id}: ${r.violationCount} violation(s) — ${r.description}`);
  }
  // eslint-disable-next-line no-console
  console.log(`[hardcode-audit] total: ${totalViolations}`);

  const baseline = loadBaseline();
  let failed = false;
  if (baseline) {
    for (const r of results) {
      const allowed = baseline[r.id] ?? 0;
      if (r.violationCount > allowed) {
        // eslint-disable-next-line no-console
        console.error(
          `[hardcode-audit] FAIL: ${r.id} — ${r.violationCount} > baseline ${allowed}`
        );
        for (const v of r.violations.slice(0, 10)) {
          // eslint-disable-next-line no-console
          console.error(`    ${v.file}:${v.line}  ${v.text}`);
        }
        failed = true;
      }
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      `[hardcode-audit] no baseline at ${BASELINE_PATH} — current counts will be used to seed one`
    );
    const seeded: Record<string, number> = {};
    for (const r of results) seeded[r.id] = r.violationCount;
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, JSON.stringify(seeded, null, 2));
    // eslint-disable-next-line no-console
    console.log(`[hardcode-audit] baseline seeded at ${BASELINE_PATH}`);
  }

  process.exit(failed ? 1 : 0);
}

main();
