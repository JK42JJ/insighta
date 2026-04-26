#!/usr/bin/env node
// Production health probe — checks Redis, YouTube API, pipeline status.
// Runs inside prod container via
// `cat scripts/probes/prod-health.mjs | ssh insighta-ec2 "docker exec -i insighta-api node --input-type=module"`
// or locally via `node scripts/probes/prod-health.mjs`.

import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';

const prisma = new PrismaClient();
const args = parseArgs(process.argv.slice(2));

async function main() {
  const report = { probeTs: new Date().toISOString(), checks: {} };

  const checks = args.blocks ?? ['redis', 'youtube', 'pipeline', 'precompute', 'api'];

  if (checks.includes('redis')) report.checks.redis = await checkRedis();
  if (checks.includes('youtube')) report.checks.youtube = checkYouTubeKeys();
  if (checks.includes('pipeline')) report.checks.pipeline = await checkPipeline();
  if (checks.includes('precompute')) report.checks.precompute = await checkPrecompute();
  if (checks.includes('api')) report.checks.api = checkApiConfig();

  const failCount = Object.values(report.checks).filter((c) => c.status === 'FAIL').length;
  report.summary = failCount === 0 ? 'ALL OK' : `${failCount} FAIL`;

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(formatReport(report));
  }

  await prisma.$disconnect();
}

// ── Redis ──────────────────────────────────────────────────────────────────
async function checkRedis() {
  const host = process.env.REDIS_HOST;
  const port = Number(process.env.REDIS_PORT ?? 6379);
  const user = process.env.REDIS_USER ?? 'insighta';
  const pass = process.env.REDIS_INSIGHTA_PASSWORD;

  if (!host) return { status: 'FAIL', error: 'REDIS_HOST not set' };
  if (!pass) return { status: 'FAIL', error: 'REDIS_INSIGHTA_PASSWORD not set' };

  let client;
  try {
    client = createClient({
      socket: { host, port, connectTimeout: 5000 },
      username: user,
      password: pass,
    });
    await client.connect();

    const topicCount = await client.sCard('topic:index');
    const dbSize = await client.dbSize();
    const info = await client.info('memory');
    const usedMemMatch = info.match(/used_memory_human:(\S+)/);

    await client.disconnect();

    return {
      status: topicCount > 0 ? 'OK' : 'WARN',
      host,
      port,
      user,
      topicIndex: topicCount,
      totalKeys: dbSize,
      usedMemory: usedMemMatch?.[1] ?? 'unknown',
      warning: topicCount === 0 ? 'topic:index is empty — RedisProvider will return 0 candidates' : null,
    };
  } catch (err) {
    if (client) try { await client.disconnect(); } catch {}
    return { status: 'FAIL', host, port, error: err.message };
  }
}

// ── YouTube API Keys ───────────────────────────────────────────────────────
function checkYouTubeKeys() {
  const keys = [];
  for (let i = 1; i <= 10; i++) {
    const suffix = i === 1 ? '' : `_${i}`;
    const k = process.env[`YOUTUBE_API_KEY_SEARCH${suffix}`];
    if (k) keys.push({ index: i, prefix: k.slice(0, 6) + '...' });
  }

  return {
    status: keys.length > 0 ? 'OK' : 'FAIL',
    keyCount: keys.length,
    keys,
    error: keys.length === 0 ? 'No YOUTUBE_API_KEY_SEARCH* keys found' : null,
  };
}

// ── Pipeline (recent recommendation_cache) ─────────────────────────────────
async function checkPipeline() {
  try {
    const recent = await prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS total_recs,
        COUNT(DISTINCT mandala_id)::int AS mandala_count,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::int AS last_hour,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS last_24h,
        MIN(created_at) AS oldest,
        MAX(created_at) AS newest
      FROM recommendation_cache
    `;

    const row = recent[0];
    return {
      status: row.total_recs > 0 ? 'OK' : 'WARN',
      totalRecs: row.total_recs,
      mandalaCount: row.mandala_count,
      lastHour: row.last_hour,
      last24h: row.last_24h,
      oldest: row.oldest?.toISOString(),
      newest: row.newest?.toISOString(),
      warning: row.last_24h === 0 ? 'No new recommendations in 24h' : null,
    };
  } catch (err) {
    return { status: 'FAIL', error: err.message };
  }
}

// ── Wizard Precompute ──────────────────────────────────────────────────────
async function checkPrecompute() {
  const enabled = process.env.WIZARD_PRECOMPUTE_ENABLED === 'true';
  if (!enabled) return { status: 'WARN', warning: 'WIZARD_PRECOMPUTE_ENABLED=false' };

  try {
    const stats = await prisma.$queryRaw`
      SELECT
        status,
        COUNT(*)::int AS cnt
      FROM mandala_wizard_precompute
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY status
      ORDER BY cnt DESC
    `;

    const statusMap = {};
    for (const r of stats) statusMap[r.status] = r.cnt;

    const failRate = statusMap.failed
      ? (statusMap.failed / Object.values(statusMap).reduce((a, b) => a + b, 0)) * 100
      : 0;

    return {
      status: failRate > 50 ? 'FAIL' : 'OK',
      enabled,
      last24h: statusMap,
      failRate: `${failRate.toFixed(1)}%`,
      warning: failRate > 50 ? `High fail rate: ${failRate.toFixed(1)}%` : null,
    };
  } catch (err) {
    return { status: 'FAIL', error: err.message };
  }
}

// ── API Config ─────────────────────────────────────────────────────────────
function checkApiConfig() {
  const flags = {
    VIDEO_DISCOVER_V3: process.env.VIDEO_DISCOVER_V3 ?? 'unset',
    V3_CENTER_GATE_MODE: process.env.V3_CENTER_GATE_MODE ?? 'unset',
    WIZARD_PRECOMPUTE_ENABLED: process.env.WIZARD_PRECOMPUTE_ENABLED ?? 'unset',
    MANDALA_EMBED_PROVIDER: process.env.MANDALA_EMBED_PROVIDER ?? 'unset',
    RICH_SUMMARY_ENABLED: process.env.RICH_SUMMARY_ENABLED ?? 'unset',
    V3_RECENCY_WEIGHT: process.env.V3_RECENCY_WEIGHT ?? 'unset',
    NODE_ENV: process.env.NODE_ENV ?? 'unset',
    REDIS_HOST: process.env.REDIS_HOST ?? 'unset',
    REDIS_USER: process.env.REDIS_USER ?? 'unset',
  };

  return { status: 'OK', flags };
}

// ── Formatter ──────────────────────────────────────────────────────────────
function formatReport(report) {
  const lines = [`\n═══ Prod Health Probe (${report.probeTs}) ═══\n`];

  for (const [name, check] of Object.entries(report.checks)) {
    const icon = check.status === 'OK' ? '✅' : check.status === 'WARN' ? '⚠️' : '❌';
    lines.push(`${icon} ${name.toUpperCase()}: ${check.status}`);

    if (name === 'redis') {
      if (check.error) { lines.push(`   Error: ${check.error}`); continue; }
      lines.push(`   Host: ${check.host}:${check.port} (user: ${check.user})`);
      lines.push(`   topic:index: ${check.topicIndex} slugs | Total keys: ${check.totalKeys} | Memory: ${check.usedMemory}`);
      if (check.warning) lines.push(`   ⚠️  ${check.warning}`);
    }

    if (name === 'youtube') {
      if (check.error) { lines.push(`   Error: ${check.error}`); continue; }
      lines.push(`   Keys: ${check.keyCount} configured`);
    }

    if (name === 'pipeline') {
      if (check.error) { lines.push(`   Error: ${check.error}`); continue; }
      lines.push(`   Total recs: ${check.totalRecs} (${check.mandalaCount} mandalas)`);
      lines.push(`   Last hour: ${check.lastHour} | Last 24h: ${check.last24h}`);
      lines.push(`   Range: ${check.oldest ?? 'N/A'} ~ ${check.newest ?? 'N/A'}`);
      if (check.warning) lines.push(`   ⚠️  ${check.warning}`);
    }

    if (name === 'precompute') {
      if (check.error) { lines.push(`   Error: ${check.error}`); continue; }
      lines.push(`   Enabled: ${check.enabled}`);
      if (check.last24h) lines.push(`   Last 24h: ${JSON.stringify(check.last24h)}`);
      if (check.warning) lines.push(`   ⚠️  ${check.warning}`);
    }

    if (name === 'api') {
      for (const [k, v] of Object.entries(check.flags)) {
        lines.push(`   ${k}: ${v}`);
      }
    }

    lines.push('');
  }

  lines.push(`\n═══ Summary: ${report.summary} ═══\n`);
  return lines.join('\n');
}

// ── Args parser ────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const result = { json: false, blocks: null };
  for (const arg of argv) {
    if (arg === '--json') result.json = true;
    if (arg.startsWith('--block=')) result.blocks = arg.slice(8).split(',');
  }
  return result;
}

main().catch((err) => {
  console.error('Probe failed:', err.message);
  process.exit(1);
});
