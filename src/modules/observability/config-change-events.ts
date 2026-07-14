/**
 * Config-change ledger — boot self-reporter (perf-monitor PR1, 2026-07-13).
 *
 * The monitor's timeline needs every runtime change as an EVENT — the 7/3
 * collapse took two days of git forensics because "what changed and when"
 * lived nowhere. Boot self-report covers all three change paths at once:
 * normal deploys, image-pin swaps that bypass deploy.yml (the 7/6 test), and
 * flag-only compose edits — anything that alters the runtime restarts the
 * container, and the container reports itself.
 *
 * Supervisor review (2026-07-13): external regressions (DeepInfra hang) have
 * NO event — "KPI drop with no marker" is itself the external-cause signal;
 * the diagnosis endpoint (PR2) states that rule and accepts manual markers.
 *
 * Pure helpers (flag gate / fingerprint / diff) live in
 * src/config/config-change-events.ts.
 */

import type { Prisma } from '@prisma/client';
import { getPrismaClient } from '@/modules/database/client';
import { logger } from '@/utils/logger';
import {
  isConfigChangeEventsEnabled,
  buildFlagsFingerprint,
  diffFlags,
  getGitSha,
} from '@/config/config-change-events';

const log = logger.child({ module: 'config-change-events' });

/**
 * Boot self-report. Compares (git_sha, flags) against the latest ledger row;
 * inserts a 'boot' event when either differs. Fire-and-forget at queue init —
 * every failure is swallowed (observability must never block serving).
 */
export async function reportBootConfigEvent(): Promise<void> {
  if (!isConfigChangeEventsEnabled()) return;
  try {
    const db = getPrismaClient();
    const gitSha = getGitSha();
    const flags = buildFlagsFingerprint();

    const latest = await db.config_change_events.findFirst({
      orderBy: { created_at: 'desc' },
      select: { git_sha: true, flags: true },
    });
    const prevFlags = (latest?.flags ?? {}) as Record<string, string>;
    const diff = diffFlags(prevFlags, flags);

    if (latest && latest.git_sha === gitSha && Object.keys(diff).length === 0) {
      return; // plain restart, nothing changed — no event noise
    }

    await db.config_change_events.create({
      data: {
        source: 'boot',
        git_sha: gitSha,
        flags,
        // first row: no meaningful diff base
        diff: latest ? (diff as unknown as Prisma.InputJsonValue) : undefined,
        note: latest ? null : 'ledger start (first boot report)',
      },
    });
    log.info(
      `config change event recorded: sha=${gitSha ?? 'unknown'} changed_flags=${Object.keys(diff).length}`
    );
  } catch (err) {
    log.warn(
      `boot config event failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
