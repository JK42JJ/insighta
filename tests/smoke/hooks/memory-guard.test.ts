/**
 * scripts/hooks/memory-guard.sh is the PreToolUse guard that blocks heavy local
 * commands (test runners, type-check, bundling, image builds) when the machine
 * is under memory pressure or another heavy command is already running.
 * The script's MEMORY_GUARD_TEST injection keeps the kernel out of these tests.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const SCRIPT = path.resolve(__dirname, '../../../scripts/hooks/memory-guard.sh');
const EXIT_ALLOW = 0;
const EXIT_BLOCK = 2;
const CALM_LEVEL = 80;
const STALLING_LEVEL = 39;
const PRESSURE_NORMAL = 1;
const PRESSURE_WARNING = 2;
const PRESSURE_CRITICAL = 4;

interface GuardState {
  pressure?: number;
  level?: number;
  running?: string;
}

let tmpHome: string;

beforeAll(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-guard-'));
});

afterAll(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function runGuard(command: string, state: GuardState = {}) {
  const result = spawnSync('bash', [SCRIPT], {
    input: JSON.stringify({ tool_input: { command } }),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: tmpHome,
      MEMORY_GUARD_TEST: '1',
      MEMORY_GUARD_TEST_PRESSURE: String(state.pressure ?? PRESSURE_NORMAL),
      MEMORY_GUARD_TEST_LEVEL: String(state.level ?? CALM_LEVEL),
      MEMORY_GUARD_TEST_RUNNING: state.running ?? '',
    },
  });
  return { status: result.status, stderr: result.stderr ?? '' };
}

function readLog(): string {
  const logPath = path.join(tmpHome, '.insighta-memory-guard.log');
  return fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8') : '';
}

describe('memory-guard.sh', () => {
  it('ignores commands that are not heavy even under critical pressure', () => {
    expect(runGuard('git status', { pressure: PRESSURE_CRITICAL }).status).toBe(EXIT_ALLOW);
  });

  it('allows a heavy command when the machine is calm and nothing heavy runs', () => {
    expect(runGuard('npx jest tests/unit').status).toBe(EXIT_ALLOW);
  });

  it('blocks a heavy command at kernel pressure level warning', () => {
    const result = runGuard('npx jest tests/unit', { pressure: PRESSURE_WARNING });
    expect(result.status).toBe(EXIT_BLOCK);
    expect(result.stderr).toContain('pressure level 2');
  });

  it('blocks a heavy command when available memory is below the floor', () => {
    const result = runGuard('cd frontend && npx vitest run', { level: STALLING_LEVEL });
    expect(result.status).toBe(EXIT_BLOCK);
    expect(result.stderr).toContain('memorystatus level 39%');
  });

  it('blocks a heavy command while another heavy command is running', () => {
    const running = '70666 node /x/node_modules/.bin/jest --json';
    const result = runGuard('npx tsc --noEmit -p tsconfig.json', { running });
    expect(result.status).toBe(EXIT_BLOCK);
    expect(result.stderr).toContain(running);
  });

  it.each([
    'npx jest',
    'npx vitest run src/foo.test.ts',
    'npx playwright test --project=chromium',
    'npx tsc --noEmit',
    'cd frontend && npx vite build',
    'npm run build',
    'npm test',
    'npm ci',
    'docker build -t insighta-api:local .',
  ])('treats "%s" as heavy', (command) => {
    expect(runGuard(command, { pressure: PRESSURE_WARNING }).status).toBe(EXIT_BLOCK);
  });

  it('always allows inspection and remediation commands that mention the tools', () => {
    expect(runGuard('pkill -f jest', { pressure: PRESSURE_CRITICAL }).status).toBe(EXIT_ALLOW);
    expect(runGuard('pgrep -fl "jest|vitest"', { pressure: PRESSURE_CRITICAL }).status).toBe(
      EXIT_ALLOW
    );
  });

  it('does not treat the bypass token as a bypass unless it is the command prefix', () => {
    const command = "git commit -m 'docs: MEMORY_GUARD_BYPASS=1 is human-only' && npx jest";
    expect(runGuard(command, { pressure: PRESSURE_WARNING }).status).toBe(EXIT_BLOCK);
  });

  it('honours the bypass prefix and logs it', () => {
    expect(runGuard('MEMORY_GUARD_BYPASS=1 npx jest', { pressure: PRESSURE_CRITICAL }).status).toBe(
      EXIT_ALLOW
    );
    expect(readLog()).toContain('BYPASS');
  });

  it('logs every block with the measured state', () => {
    runGuard('npm run build', { pressure: PRESSURE_WARNING, level: STALLING_LEVEL });
    expect(readLog()).toMatch(/BLOCK \| pressure=2 level=39/);
  });
});
