/**
 * skillRegistry is imported from the module that fills it (regression, 2026-08-24).
 *
 * `@/modules/skills/registry` exports a SkillRegistry whose Map starts empty.
 * `@/modules/skills` re-exports that same object AND performs the side-effect
 * import (`import '@/skills/index'`) that registers every plugin into it.
 *
 * The api process loaded the index by accident of routing -- routes/skills.ts
 * imports it -- so importing the bare registry read correct there. The worker
 * has no routes: its registry stayed empty and every batch-video-collector-run
 * failed with "Skill not found", twice a day, from at least 2026-08-21.
 *
 * The watchdog runs trend-collector first, spending ~25 LLM calls to build
 * keywords, then hands them to a job that cannot start. The money was spent and
 * the output discarded, daily, with no signal -- that call path is also one of
 * the five that never wrote to llm_call_logs.
 *
 * Second defect of this shape from the web/worker split; the first was the api
 * not starting pg-boss (2026-08-20). Both are a process missing something the
 * api happened to have by side effect.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../..');

/** The two files that are allowed to name the bare registry module. */
const ALLOWED = ['src/modules/skills/index.ts', 'src/modules/skills/registry.ts'];

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!/node_modules|__tests__/.test(p)) sourceFiles(p, acc);
    } else if (e.name.endsWith('.ts')) acc.push(p);
  }
  return acc;
}

describe('skill registry is imported from where it is populated', () => {
  const files = sourceFiles(path.join(ROOT, 'src'));

  it('finds source files to check', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('no file imports skillRegistry from the bare registry module', () => {
    // Stated as an invariant rather than a list of known callers: a new caller
    // added later is exactly how this returns, and a list would not see it.
    const offenders = files
      .filter((f) => !ALLOWED.includes(path.relative(ROOT, f)))
      .filter((f) =>
        /import\s*\{[^}]*skillRegistry[^}]*\}\s*from\s*'[^']*modules\/skills\/registry'/.test(
          fs.readFileSync(f, 'utf-8')
        )
      )
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual([]);
  });

  it('the index performs the side-effect import and the registry does not', () => {
    // If this moves, the assertion above stops meaning anything and the failure
    // comes back silently.
    const index = fs.readFileSync(path.join(ROOT, 'src/modules/skills/index.ts'), 'utf-8');
    expect(index).toMatch(/import\s+'@\/skills\/index'/);
    expect(index).toMatch(/export\s*\{\s*skillRegistry\s*\}/);

    const registry = fs.readFileSync(path.join(ROOT, 'src/modules/skills/registry.ts'), 'utf-8');
    expect(registry).not.toMatch(/import\s+'@\/skills\/index'/);
  });
});
