/**
 * The staging database scripts destroy data in three schemas. They must never be
 * able to run against anything but the staging project, and the check has to
 * happen before a connection is opened. These cases run the real scripts with no
 * database reachable: a refusal is the only outcome that can produce the
 * expected message, and a script that got past the guard would fail on connect
 * with a different one.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';

const OPS = path.join(__dirname, '../../scripts/ops');
const REBUILD = path.join(OPS, 'rebuild-stg-db.sh');
const CLEAN = path.join(OPS, 'clean-stg-data.sh');
const SYNC = path.join(OPS, 'sync-stg-reference.sh');
const KEEP_FILE = path.join(OPS, 'stg-keep-tables.txt');
const REFERENCE_FILE = path.join(OPS, 'stg-reference-tables.txt');

const REFUSED_EXIT = 2;
const STG_REF = 'stgref0000000000000';
const PROD_URL = 'postgresql://postgres.prodref0000000000000:pw@host.invalid:5432/postgres';
const STG_URL = `postgresql://postgres.${STG_REF}:pw@host.invalid:5432/postgres`;

function run(script: string, env: Record<string, string>, args: string[]) {
  return spawnSync('/bin/bash', [script, ...args], {
    env: { PATH: '/usr/bin:/bin', ...env },
    encoding: 'utf-8',
  });
}

function tmpFile(content: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stg-db-'));
  const file = path.join(dir, 'file.txt');
  fs.writeFileSync(file, content);
  return file;
}

function baselineDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stg-baseline-'));
  fs.writeFileSync(path.join(dir, 'schema.sql'), '');
  fs.writeFileSync(path.join(dir, 'buckets.sql'), '');
  return dir;
}

describe.each([
  ['rebuild-stg-db.sh', REBUILD, () => [baselineDir()]],
  ['clean-stg-data.sh', CLEAN, () => [KEEP_FILE]],
  ['sync-stg-reference.sh', SYNC, () => [REFERENCE_FILE]],
])('%s refuses anything that is not the staging project', (_name, script, args) => {
  it('refuses a connection string for another project', () => {
    const r = run(script, { STG_PROJECT_REF: STG_REF, STG_DIRECT_URL: PROD_URL }, args());
    expect(r.status).toBe(REFUSED_EXIT);
    expect(r.stderr).toMatch(new RegExp(`does not name project ${STG_REF}`));
  });

  it('refuses when the project ref is not set', () => {
    const r = run(script, { STG_DIRECT_URL: STG_URL }, args());
    expect(r.status).toBe(REFUSED_EXIT);
    expect(r.stderr).toMatch(/STG_PROJECT_REF is not set/);
  });

  it('refuses when the connection string is not set', () => {
    const r = run(script, { STG_PROJECT_REF: STG_REF }, args());
    expect(r.status).toBe(REFUSED_EXIT);
    expect(r.stderr).toMatch(/STG_DIRECT_URL is not set/);
  });
});

describe('rebuild-stg-db.sh inputs', () => {
  it('refuses without a baseline directory', () => {
    const r = run(REBUILD, { STG_PROJECT_REF: STG_REF, STG_DIRECT_URL: STG_URL }, []);
    expect(r.status).toBe(REFUSED_EXIT);
    expect(r.stderr).toMatch(/usage: rebuild-stg-db\.sh/);
  });

  it('refuses a baseline directory with no schema', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'stg-empty-'));
    const r = run(REBUILD, { STG_PROJECT_REF: STG_REF, STG_DIRECT_URL: STG_URL }, [empty]);
    expect(r.status).toBe(REFUSED_EXIT);
    expect(r.stderr).toMatch(/no schema\.sql in/);
  });
});

describe('clean-stg-data.sh keep file', () => {
  const env = { STG_PROJECT_REF: STG_REF, STG_DIRECT_URL: STG_URL };

  it('refuses a missing keep file', () => {
    const r = run(CLEAN, env, ['/nonexistent/keep.txt']);
    expect(r.status).toBe(REFUSED_EXIT);
    expect(r.stderr).toMatch(/no keep file at/);
  });

  it('refuses a keep file that lists nothing, since that would clear everything', () => {
    const r = run(CLEAN, env, [tmpFile('# only a comment\n\n')]);
    expect(r.status).toBe(REFUSED_EXIT);
    expect(r.stderr).toMatch(/lists no tables/);
  });

  it('refuses an entry that is not schema.table, so nothing odd reaches the SQL', () => {
    const r = run(CLEAN, env, [
      tmpFile("public.system_settings'); DROP TABLE x; --  # injected\n"),
    ]);
    expect(r.status).toBe(REFUSED_EXIT);
    expect(r.stderr).toMatch(/not schema\.table/);
  });

  it('refuses an entry outside the three data schemas', () => {
    const r = run(CLEAN, env, [tmpFile('auth.users  # never\n')]);
    expect(r.status).toBe(REFUSED_EXIT);
    expect(r.stderr).toMatch(/not schema\.table/);
  });
});

describe('sync-stg-reference.sh inputs', () => {
  const env = {
    STG_PROJECT_REF: STG_REF,
    STG_DIRECT_URL: STG_URL,
    PROD_DIRECT_URL: PROD_URL,
  };

  it('refuses without a prod connection string to read from', () => {
    const r = run(SYNC, { STG_PROJECT_REF: STG_REF, STG_DIRECT_URL: STG_URL }, [REFERENCE_FILE]);
    expect(r.status).toBe(REFUSED_EXIT);
    expect(r.stderr).toMatch(/PROD_DIRECT_URL is not set/);
  });

  it('refuses a prod connection string that names the staging project', () => {
    const r = run(SYNC, { ...env, PROD_DIRECT_URL: STG_URL }, [REFERENCE_FILE]);
    expect(r.status).toBe(REFUSED_EXIT);
    expect(r.stderr).toMatch(/PROD_DIRECT_URL names the staging project/);
  });

  it('refuses a missing reference file', () => {
    const r = run(SYNC, env, ['/nonexistent/reference.txt']);
    expect(r.status).toBe(REFUSED_EXIT);
    expect(r.stderr).toMatch(/no reference file at/);
  });

  it('refuses an entry that is not schema.table', () => {
    const r = run(SYNC, env, [tmpFile('public.x; DROP TABLE y  # injected\n')]);
    expect(r.status).toBe(REFUSED_EXIT);
    expect(r.stderr).toMatch(/not schema\.table/);
  });

  it('refuses a second field that is not null:col', () => {
    const r = run(SYNC, env, [tmpFile('public.system_settings  nullify:updated_by  # x\n')]);
    expect(r.status).toBe(REFUSED_EXIT);
    expect(r.stderr).toMatch(/not null:col/);
  });
});

describe('stg-keep-tables.txt', () => {
  const entries = fs
    .readFileSync(KEEP_FILE, 'utf-8')
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));

  it('lists tables', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('gives every entry a schema.table name and a reason', () => {
    for (const line of entries) {
      expect(line).toMatch(/^(public|ontology|slidegen)\.[a-z0-9_]+\s+#\s*\S/);
    }
  });

  it('lists no table twice', () => {
    const names = entries.map((line) => line.split(/\s+/)[0]);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('stg-reference-tables.txt', () => {
  const lines = (file: string) =>
    fs
      .readFileSync(file, 'utf-8')
      .split('\n')
      .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'));
  const tableOf = (line: string) => line.split(/\s+/)[0] ?? '';

  const reference = lines(REFERENCE_FILE);
  const keep = new Set(lines(KEEP_FILE).map(tableOf));

  it('gives every entry a schema.table name, an optional null: list, and a reason', () => {
    for (const line of reference) {
      expect(line).toMatch(
        /^(public|ontology|slidegen)\.[a-z0-9_]+(\s+null:[a-z0-9_]+(,[a-z0-9_]+)*)?\s+#\s*\S/
      );
    }
  });

  it('lists no table twice', () => {
    const names = reference.map(tableOf);
    expect(new Set(names).size).toBe(names.length);
  });

  it('is a subset of the keep list, or the next clean would empty what it copied', () => {
    const missing = reference.map(tableOf).filter((t) => !keep.has(t));
    expect(missing).toEqual([]);
  });
});

describe('stg-clean.yml', () => {
  type Step = { run?: string; env?: Record<string, string> };
  const wf = yaml.load(
    fs.readFileSync(path.join(__dirname, '../../.github/workflows/stg-clean.yml'), 'utf-8')
  ) as { jobs: Record<string, { steps?: Step[] }> };
  const steps = wf.jobs['clean']?.steps ?? [];
  const find = (needle: string) => steps.findIndex((st) => (st.run ?? '').includes(needle));

  it('cleans before it refreshes the reference rows', () => {
    const clean = find('clean-stg-data.sh');
    const sync = find('sync-stg-reference.sh');
    expect(clean).toBeGreaterThanOrEqual(0);
    expect(sync).toBeGreaterThan(clean);
  });

  it('writes with the staging secret and reads prod with the prod secret, never the reverse', () => {
    const clean = steps[find('clean-stg-data.sh')];
    const sync = steps[find('sync-stg-reference.sh')];
    expect(clean?.env?.['STG_DIRECT_URL']).toBe('${{ secrets.STG_DIRECT_URL }}');
    expect(sync?.env?.['STG_DIRECT_URL']).toBe('${{ secrets.STG_DIRECT_URL }}');
    expect(sync?.env?.['PROD_DIRECT_URL']).toBe('${{ secrets.DIRECT_URL }}');
    expect(clean?.env?.['PROD_DIRECT_URL']).toBeUndefined();
  });
});
