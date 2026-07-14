/**
 * Deploy env-injection contract (regression, 2026-07-14 CSE silent-0).
 *
 * Failure class: a config module reads an env var, but deploy.yml never
 * writes it to the EC2 .env — the feature silently degrades for months
 * (GOOGLE_CSE_* was name-registered at CP458, code shipped at CP504, yet
 * research yielded 0 findings and factcheck ran without web evidence
 * because the credentials were never injected anywhere).
 *
 * This test pins the contract: every env var listed here MUST have a
 * sync line in deploy.yml's .env-write block.
 */
import * as fs from 'fs';
import * as path from 'path';

const DEPLOY_YML = path.join(__dirname, '../../.github/workflows/deploy.yml');

// Env vars whose ONLY production injection path is the deploy.yml .env sync.
const ENV_SYNCED_VARS = [
  'OPENROUTER_API_KEY',
  'COHERE_API_KEY',
  'GOOGLE_CSE_API_KEY',
  'GOOGLE_CSE_CX',
];

describe('deploy.yml env-injection contract', () => {
  const yml = fs.readFileSync(DEPLOY_YML, 'utf-8');

  it.each(ENV_SYNCED_VARS)('%s has a .env sync line', (name) => {
    // The idempotent sync pattern: grep -q '^NAME=' .env ... || echo "NAME=..." >> .env
    expect(yml).toMatch(new RegExp(`\\^${name}=`));
    expect(yml).toContain(`${name}=`);
  });
});
