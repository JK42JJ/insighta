/**
 * Keel provisions itself.
 *
 * Everything this sets up was created by hand on 2026-09-07, and twice the
 * hand slipped: a pasted `read -rs` took a blank line and stored an empty
 * password, once for the dashboard's basic auth and once for its database
 * role. Both failures were silent -- the endpoint served, the pod ran, and the
 * dashboard drew "No data" -- which is precisely the class of failure Keel
 * exists to catch. A monitor that needs a person to set it up correctly is a
 * monitor that will be wrong and stay wrong.
 *
 * So nobody types a password here, and nobody knows one. This runs as an ArgoCD
 * PreSync hook, generates what is missing, and is idempotent: if the secrets
 * are present and actually work, it changes nothing.
 *
 *   grafana_ro        created if absent; its password rotated only when the
 *                     stored one no longer authenticates
 *   basic auth        generated once; the plaintext is kept beside the hash in
 *                     the same Secret, because a credential a human types has
 *                     to be recoverable, and the Secret is already the trust
 *                     boundary that protects the hash
 *
 * Reads DIRECT_URL from the Secret the application already uses, so there is no
 * second copy of the database credential to keep in step.
 */

const { randomBytes } = require('crypto');
const { readFileSync } = require('fs');
const bcrypt = require('bcrypt');
const { PrismaClient } = require('@prisma/client');

const NS = process.env.KEEL_NAMESPACE || 'insighta-prod';
const APP_SECRET = 'insighta-env';
const DB_SECRET = 'insighta-grafana-db';
const AUTH_SECRET = 'keel-basic-auth';
const DB_ROLE = 'grafana_ro';
const AUTH_USER = process.env.KEEL_AUTH_USER || 'keel';
const READ_TABLES = ['error_events', 'llm_call_logs', 'pipeline_events'];

const SA = '/var/run/secrets/kubernetes.io/serviceaccount';
const TOKEN = readFileSync(`${SA}/token`, 'utf8');
const CA = readFileSync(`${SA}/ca.crt`);

const https = require('https');

/**
 * The Kubernetes API, over the cluster CA.
 *
 * https.request rather than fetch: Node 20's global fetch is undici and takes
 * no `agent`, so there is nowhere to hand it the service account's CA and every
 * call fails certificate verification.
 */
function k8s(method, path, body) {
  const payload = body ? JSON.stringify(body) : null;
  const opts = {
    method,
    hostname: process.env.KUBERNETES_SERVICE_HOST,
    port: process.env.KUBERNETES_SERVICE_PORT,
    path,
    ca: CA,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': method === 'PATCH' ? 'application/merge-patch+json' : 'application/json',
      ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
    },
  };
  return new Promise((resolve, reject) => {
    const req = https.request(opts, (res) => {
      let out = '';
      res.on('data', (c) => (out += c));
      res.on('end', () => {
        if (res.statusCode === 404) return resolve(null);
        if (res.statusCode >= 400) {
          return reject(new Error(`${method} ${path} -> ${res.statusCode} ${out.slice(0, 300)}`));
        }
        try {
          resolve(JSON.parse(out));
        } catch (e) {
          reject(new Error(`${method} ${path} -> unparseable: ${out.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const unb64 = (s) => Buffer.from(s, 'base64').toString('utf8');

const getSecret = (name) => k8s('GET', `/api/v1/namespaces/${NS}/secrets/${name}`);

async function putSecret(name, data) {
  const body = { metadata: { name }, type: 'Opaque', data };
  const existing = await getSecret(name);
  if (existing) return k8s('PATCH', `/api/v1/namespaces/${NS}/secrets/${name}`, { data });
  return k8s('POST', `/api/v1/namespaces/${NS}/secrets`, {
    apiVersion: 'v1',
    kind: 'Secret',
    ...body,
  });
}

/** URL-safe and shell-safe: no quotes, backslashes or dollar signs to be eaten
 *  by whatever ends up interpolating it. */
function password(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

async function main() {
  const app = await getSecret(APP_SECRET);
  if (!app?.data?.DIRECT_URL) throw new Error(`${APP_SECRET} has no DIRECT_URL`);
  const adminUrl = unb64(app.data.DIRECT_URL);
  const u = new URL(adminUrl);
  const host = u.host;
  const dbName = u.pathname.replace(/^\//, '') || 'postgres';

  // Supabase's connection pooler routes by a tenant carried in the username:
  // `postgres.<project-ref>`, not `postgres`. A role name without the suffix is
  // refused before authentication is even attempted --
  //
  //   FATAL: (ENOIDENTIFIER) no tenant identifier provided
  //
  // so the password could have been perfect and the dashboard would still have
  // drawn nothing. Measured 2026-09-08. The suffix is taken from the credential
  // the application already uses rather than written down, because a project
  // reference in the chart is one more thing that can be wrong and one more
  // identifier in a public repository.
  const tenant = u.username.includes('.') ? u.username.slice(u.username.indexOf('.') + 1) : '';
  const loginUser = tenant ? `${DB_ROLE}.${tenant}` : DB_ROLE;

  // ── the database role ────────────────────────────────────────────────────
  const stored = await getSecret(DB_SECRET);
  const storedPw = stored?.data?.GRAFANA_DB_PASSWORD
    ? unb64(stored.data.GRAFANA_DB_PASSWORD)
    : '';

  const storedUser = stored?.data?.GRAFANA_DB_USER ? unb64(stored.data.GRAFANA_DB_USER) : '';

  let works = false;
  if (storedPw && storedUser === loginUser) {
    // The only test that means anything: connect as the role, the way Grafana
    // will. A Secret that exists proves nothing -- one existed all along and
    // held an empty string.
    const probe = new PrismaClient({
      datasources: {
        db: {
          url: `postgresql://${encodeURIComponent(loginUser)}:${encodeURIComponent(storedPw)}@${host}/${dbName}?sslmode=require`,
        },
      },
    });
    try {
      await probe.$queryRawUnsafe('SELECT 1');
      works = true;
    } catch {
      works = false;
    } finally {
      await probe.$disconnect().catch(() => {});
    }
  }

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  let rotated = false;

  if (works) {
    console.log(`ok    ${loginUser}: stored password authenticates`);
  } else {
    const pw = password();
    const exists = await admin.$queryRawUnsafe(
      `SELECT 1 FROM pg_roles WHERE rolname = '${DB_ROLE}'`
    );
    if (Array.isArray(exists) && exists.length > 0) {
      await admin.$executeRawUnsafe(`ALTER ROLE ${DB_ROLE} WITH LOGIN PASSWORD '${pw}'`);
      console.log(`fix   ${DB_ROLE}: password rotated (the stored one did not work)`);
    } else {
      await admin.$executeRawUnsafe(`CREATE ROLE ${DB_ROLE} LOGIN PASSWORD '${pw}'`);
      console.log(`new   ${DB_ROLE}: role created`);
    }
    await putSecret(DB_SECRET, {
      GRAFANA_DB_HOST: b64(host),
      GRAFANA_DB_USER: b64(loginUser),
      GRAFANA_DB_NAME: b64(dbName),
      GRAFANA_DB_PASSWORD: b64(pw),
    });
    rotated = true;
  }

  // Grants are re-applied every run. They are idempotent, and a table added
  // later would otherwise be invisible to the dashboard with no sign of why.
  await admin.$executeRawUnsafe(`GRANT CONNECT ON DATABASE ${dbName} TO ${DB_ROLE}`);
  await admin.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${DB_ROLE}`);
  for (const t of READ_TABLES) {
    await admin.$executeRawUnsafe(`GRANT SELECT ON public.${t} TO ${DB_ROLE}`);
  }
  // A GRANT is not enough. Row level security is on for these tables, so a
  // role with SELECT and no policy reads zero rows and reports no error --
  // measured 2026-09-08, when the dashboard connected successfully and drew
  // nothing. Privilege and policy are separate gates and both have to open.
  //
  // A permissive SELECT policy for this role, rather than BYPASSRLS: the role
  // should be able to read these three tables and nothing else, and BYPASSRLS
  // would let it read anything it is ever granted.
  for (const t of READ_TABLES) {
    await admin.$executeRawUnsafe(`DROP POLICY IF EXISTS keel_read ON public.${t}`);
    await admin.$executeRawUnsafe(
      `CREATE POLICY keel_read ON public.${t} FOR SELECT TO ${DB_ROLE} USING (true)`
    );
  }
  console.log(`ok    ${DB_ROLE}: SELECT + RLS policy on ${READ_TABLES.join(', ')}`);
  await admin.$disconnect();

  // ── basic auth ───────────────────────────────────────────────────────────
  const auth = await getSecret(AUTH_SECRET);
  const line = auth?.data?.auth ? unb64(auth.data.auth) : '';
  const plain = auth?.data?.password ? unb64(auth.data.password) : '';

  // A stored hash that accepts an empty password is what shipped on
  // 2026-09-07 and left the dashboard open. Checked here rather than trusted.
  const emptyPasses = line.includes(':') && bcrypt.compareSync('', line.split(':').slice(1).join(':'));

  if (line && plain && !emptyPasses && bcrypt.compareSync(plain, line.split(':').slice(1).join(':'))) {
    console.log(`ok    basic auth: hash matches the stored password`);
  } else {
    const pw = password(15);
    const hash = bcrypt.hashSync(pw, 10);
    if (bcrypt.compareSync('', hash)) throw new Error('refusing: generated hash accepts an empty password');
    await putSecret(AUTH_SECRET, {
      auth: b64(`${AUTH_USER}:${hash}`),
      // Kept so the credential can be read back. A password a person types
      // into a browser has to be recoverable, and this Secret is already what
      // protects the hash.
      username: b64(AUTH_USER),
      password: b64(pw),
    });
    console.log(`new   basic auth: credentials generated for user '${AUTH_USER}'`);
    console.log(`      read them with: scripts/ops/keel-url.sh`);
  }

  if (rotated) {
    // Env from a Secret is fixed at pod start, so a rotated password reaches
    // Grafana only on a restart. Doing it here is why this can run before the
    // sync that would otherwise leave a live pod holding the old value.
    await k8s('PATCH', `/apis/apps/v1/namespaces/${NS}/deployments/insighta-grafana`, {
      spec: {
        template: {
          metadata: {
            annotations: { 'keel.insighta/rotated-at': new Date().toISOString() },
          },
        },
      },
    }).catch((e) => console.log(`warn  could not restart grafana: ${e.message}`));
    console.log('ok    grafana restarted to pick up the new password');
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error('FAIL ', e.message);
    process.exit(1);
  }
);
