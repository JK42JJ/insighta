/**
 * Env-injection contract (regression, 2026-07-14 CSE silent-0).
 *
 * Failure class: a config module reads an env var that nothing puts into the
 * running container, so the feature degrades silently for months. GOOGLE_CSE_*
 * was name-registered at CP458 and the code shipped at CP504, yet research
 * returned 0 findings and factcheck ran without web evidence, because the
 * credentials were never injected anywhere. On 2026-07-14 the evidence source
 * moved to Naver plus the OpenRouter web plugin.
 *
 * The mechanism this pins changed on 2026-08-19. It used to be deploy.yml
 * writing a .env file onto an EC2 host over SSH; that host was released and the
 * job with it. Values now reach the container from the `insighta-env` secret in
 * the cluster, pulled in with envFrom.
 *
 * The contract is the same and the failure it prevents is the same: a variable
 * the code reads must have exactly one declared path into the container, and
 * that path must be visible in this repository rather than assumed.
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.join(__dirname, '../..');
const API_TEMPLATE = path.join(ROOT, 'charts/insighta/templates/api.yaml');
const WORKER_TEMPLATE = path.join(ROOT, 'charts/insighta/templates/worker.yaml');
const DEPLOY_YML = path.join(ROOT, '.github/workflows/deploy.yml');

/** Vars whose only production injection path is the cluster secret. */
const ENV_SYNCED_VARS = [
  'OPENROUTER_API_KEY',
  'COHERE_API_KEY',
  'NAVER_CLIENT_ID',
  'NAVER_CLIENT_SECRET',
];

/** The secret those values live in, created outside git and holding 144 keys. */
const SECRET_NAME = 'insighta-env';

describe('env-injection contract', () => {
  const api = fs.readFileSync(API_TEMPLATE, 'utf-8');
  const worker = fs.readFileSync(WORKER_TEMPLATE, 'utf-8');

  it.each([
    ['api', api],
    ['worker', worker],
  ])('%s pulls its whole environment from one secret', (_name, tpl) => {
    // envFrom is what makes every key in the secret present in the container.
    // Naming variables individually is the arrangement that let GOOGLE_CSE_*
    // go missing, so the assertion is on the bulk form.
    expect(tpl).toMatch(/envFrom:/);
    expect(tpl).toMatch(/secretRef:/);
    expect(tpl).toMatch(/\.Values\.envSecretName/);
  });

  it('the secret that name resolves to is the one holding the keys', () => {
    // The template references a value; this pins what the value is, so a rename
    // in the chart cannot quietly point the deployment at an empty secret.
    const values = fs.readFileSync(path.join(ROOT, 'charts/insighta/values.yaml'), 'utf-8');
    expect(values).toMatch(new RegExp(`envSecretName:\\s*${SECRET_NAME}`));
  });

  it.each(ENV_SYNCED_VARS)('%s is not injected by any second path', (name) => {
    // Two paths mean one can drift or be removed while the other hides it.
    // The deploy workflow used to write these into a .env file; that job is
    // gone, and this asserts it does not come back by accident.
    const yml = fs.readFileSync(DEPLOY_YML, 'utf-8');
    const writesEnvFile = new RegExp(`\\^${name}=.*>>.*\\.env`, 'm');
    expect(yml).not.toMatch(writesEnvFile);
  });

  it('the workflow no longer addresses the released host', () => {
    // The host that served the site before the cutover was released on
    // 2026-08-19. A reference to it here would be a job that cannot succeed.
    const yml = fs.readFileSync(DEPLOY_YML, 'utf-8');
    const uses = yml.split('\n').filter((l) => l.includes('EC2_HOST') && !l.trim().startsWith('#'));
    expect(uses).toEqual([]);
  });
});
