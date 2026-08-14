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
  /** Directory to search. Defaults to `src`; the CSS rule needs `frontend`. */
  searchRoot?: string;
}

const REPO_ROOT = resolve(__dirname, '..', '..');
const REPORT_DIR = resolve(REPO_ROOT, 'reports', 'hardcode-audit');
const BASELINE_PATH = resolve(REPORT_DIR, 'baseline.json');

const RULES: RuleDef[] = [
  {
    id: 'ms-per-day-redeclared',
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
  {
    // A colour written straight into a declaration is one the theme cannot
    // reach. Defining a token is how a colour enters the system, so lines that
    // declare a custom property (`--cd-chip-bg: rgba(...)`) are exempt and
    // everything else is counted. Baseline-gated like the rest: the existing
    // literals are recorded, and the count may only go down.
    id: 'css-color-literal',
    description: 'Colour literal in a CSS declaration (define a token and reference it)',
    // rg has no look-around, so the token-definition exemption is applied in
    // code below rather than in the pattern.
    pattern: String.raw`#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(`,
    allowedFileGlobs: [],
    searchRoot: 'frontend/public/mobile',
    searchGlobs: ['**/*.html', '**/*.css'],
  },
];

interface RuleResult {
  id: string;
  description: string;
  violationCount: number;
  violations: Array<{ file: string; line: number; text: string }>;
  /** Set when the rule could not be evaluated. Never the same as zero. */
  skipped?: string;
}

/**
 * rg exits 1 for "searched fine, matched nothing" and 2 for "could not
 * search" — a missing searchRoot being the case that matters here, because a
 * rule pointed at a directory that is not in the checkout audits nothing.
 * Told apart so the caller can treat the two differently: one is a clean zero,
 * the other is a rule that did not run.
 */
export type RgOutcome =
  | { kind: 'output'; stdout: string }
  | { kind: 'missing-path'; message: string };

export function classifyRgError(err: unknown): RgOutcome | null {
  const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number | null };
  const stdout = typeof e.stdout === 'string' ? e.stdout : '';
  if (e.status === 1) return { kind: 'output', stdout };
  const stderr = typeof e.stderr === 'string' ? e.stderr : String(e.stderr ?? '');
  if (e.status === 2 && /No such file or directory/i.test(stderr)) {
    return { kind: 'missing-path', message: stderr.trim() };
  }
  return null; // not ours to interpret — let it throw
}

function runRg(pattern: string, searchGlobs: string[], searchRoot = 'src'): RgOutcome {
  const globArgs = searchGlobs.map((g) => `--glob '${g}'`).join(' ');
  try {
    const out = execSync(`rg --json --line-number -e '${pattern}' ${globArgs} ${searchRoot}`, {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 32 * 1024 * 1024,
    });
    return { kind: 'output', stdout: out };
  } catch (err) {
    const outcome = classifyRgError(err);
    if (outcome) return outcome;
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
  const searchGlobs = rule.searchGlobs ?? ['!**/__tests__/**', '!**/*.test.ts', '!**/*.spec.ts'];
  const outcome = runRg(rule.pattern, searchGlobs, rule.searchRoot);
  if (outcome.kind === 'missing-path') {
    // Zero violations here would be a lie: nothing was searched. Carry the
    // reason so the rule is reported as unevaluated rather than clean.
    return {
      id: rule.id,
      description: rule.description,
      violationCount: 0,
      violations: [],
      skipped: `searchRoot '${rule.searchRoot ?? 'src'}' not in this checkout — ${outcome.message}`,
    };
  }
  const violations: RuleResult['violations'] = [];
  for (const line of outcome.stdout.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type !== 'match') continue;
      const filePath = event.data.path.text as string;
      if (matchesAnyGlob(filePath, rule.allowedFileGlobs)) continue;
      const text = (event.data.lines.text as string).trim();
      // Skip hour-literal hits that are part of the day literal (counted separately).
      if (
        rule.id === 'raw-ms-per-hour-literal' &&
        /\b24\s*\*\s*60\s*\*\s*60\s*\*\s*1000\b/.test(text)
      ) {
        continue;
      }
      // Defining a token is how a colour is allowed to enter the system; the
      // rule is about colours written straight into a declaration, where the
      // theme cannot reach them.
      if (rule.id === 'css-color-literal') {
        if (/--[a-z0-9-]+\s*:/i.test(text)) continue;
        // rgba(var(--shade),.3) is a TOKEN with an alpha applied -- the one
        // correct way to make a themed colour translucent, and already the
        // house style. Counting it taught the opposite lesson: it pushed you
        // toward writing the channels out by hand. Strip those calls and judge
        // whatever literal is left on the line.
        const stripped = text.replace(/\b(?:rgba?|hsla?)\(\s*var\([^)]*\)[^)]*\)/gi, '');
        if (/\brgba?\(|\bhsla?\(/.test(stripped)) {
          /* a colour function is always a value */
        } else {
          // A #hex is only a COLOUR where a value can go, which means after a
          // colon. An id selector can spell one by accident -- #cdFeed is six
          // hex digits -- and counting those taught nothing except to rename
          // the element.
          const hex = /#[0-9a-fA-F]{3,8}\b/g;
          let isValue = false;
          for (let m = hex.exec(stripped); m; m = hex.exec(stripped)) {
            if (stripped.lastIndexOf(':', m.index) !== -1) {
              isValue = true;
              break;
            }
          }
          if (!isValue) continue;
        }
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
  const stampedPath = resolve(REPORT_DIR, `report-${report.generatedAt.replace(/[:]/g, '-')}.json`);
  writeFileSync(stampedPath, JSON.stringify(report, null, 2));
  const latestPath = resolve(REPORT_DIR, 'latest.json');
  writeFileSync(latestPath, JSON.stringify(report, null, 2));

  // eslint-disable-next-line no-console
  console.log(`[hardcode-audit] report: ${stampedPath}`);
  for (const r of results) {
    // eslint-disable-next-line no-console
    if (r.skipped) console.log(`  ${r.id}: SKIPPED — ${r.description}`);
    else console.log(`  ${r.id}: ${r.violationCount} violation(s) — ${r.description}`);
  }
  // eslint-disable-next-line no-console
  console.log(`[hardcode-audit] total: ${totalViolations}`);

  const baseline = loadBaseline();
  let failed = false;

  // A rule that could not run is not a rule that passed. Reported before the
  // baseline comparison so it cannot be read as a clean result, and it fails
  // the run: the fix is to point the rule at a path this checkout has, or to
  // retire the rule in the same change that removed the path.
  const skipped = results.filter((r) => r.skipped);
  for (const r of skipped) {
    // eslint-disable-next-line no-console
    console.error(`[hardcode-audit] NOT EVALUATED: ${r.id} — ${r.skipped}`);
    failed = true;
  }

  if (baseline) {
    for (const r of results) {
      if (r.skipped) continue;
      const allowed = baseline[r.id] ?? 0;
      if (r.violationCount > allowed) {
        // eslint-disable-next-line no-console
        console.error(`[hardcode-audit] FAIL: ${r.id} — ${r.violationCount} > baseline ${allowed}`);
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
    // Seeding a skipped rule at 0 would lock it there — the baseline may only
    // move down, so a directory that was simply absent on seeding day would
    // become a permanent zero nobody could explain.
    const seeded: Record<string, number> = {};
    for (const r of results) {
      if (r.skipped) continue;
      seeded[r.id] = r.violationCount;
    }
    mkdirSync(dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, JSON.stringify(seeded, null, 2));
    // eslint-disable-next-line no-console
    console.log(`[hardcode-audit] baseline seeded at ${BASELINE_PATH}`);
  }

  process.exit(failed ? 1 : 0);
}

// Only when run as a command. Importing the module — which the regression
// test does, to reach classifyRgError — must not run the audit and call
// process.exit.
if (require.main === module) main();
