/**
 * Observability Phase 2-A — 🔴 YouTube SEARCH key-count alarm.
 *
 * Distributing search.list across MULTIPLE Google projects (multi-key) violates
 * YouTube ToS and risks a ban on ALL of them at once (M4 finding: 8 active SEARCH
 * keys). This daily job counts the active SEARCH key pool and, when it exceeds the
 * threshold (default 1), emails the operator. Counts only — key VALUES are never
 * logged or sent.
 *
 * Inert by default: emails only when OBSERVABILITY_ALERT_EMAIL is set (the job
 * still logs the count either way). Schedule = pg-boss boss.schedule (no new
 * stack); mail = the shared mailer transporter.
 */

import { config } from '@/config/index';
import { logger } from '@/utils/logger';
import { transporter } from '@/modules/skills/mailer';
import {
  resolveSearchApiKeys,
  resolveVideosApiKeys,
} from '@/skills/plugins/video-discover/v2/youtube-client';
import { getJobQueue } from '../manager';
import { JOB_NAMES, QUEUE_CONFIG } from '../types';

const log = logger.child({ module: 'key-alarm' });

export interface KeyAlarmEval {
  searchKeys: number;
  videosKeys: number;
  maxKeys: number;
  shouldAlarm: boolean;
}

/**
 * Pure evaluation — counts the active key pools and decides whether to alarm.
 * No I/O, no key values; safe to unit-test.
 */
export function evaluateKeyAlarm(
  env: Readonly<Record<string, string | undefined>>,
  maxKeys: number
): KeyAlarmEval {
  const searchKeys = resolveSearchApiKeys(env).length;
  const videosKeys = resolveVideosApiKeys(env).length;
  return { searchKeys, videosKeys, maxKeys, shouldAlarm: searchKeys > maxKeys };
}

function buildKeyAlarmText(searchKeys: number, videosKeys: number, maxKeys: number): string {
  return [
    `🔴 Insighta ops alarm — YouTube SEARCH key count`,
    ``,
    `Active SEARCH keys: ${searchKeys} (threshold ${maxKeys}, expected 1).`,
    `Active VIDEOS keys: ${videosKeys} (informational).`,
    ``,
    `Distributing search.list across multiple Google projects violates the`,
    `YouTube API ToS and risks a simultaneous ban on ALL of these keys/accounts.`,
    `Consolidate to a single SEARCH key (8→1) before the beta launch and pursue a`,
    `quota increase on that one project instead.`,
    ``,
    `(This is an automated daily count — no key values are transmitted.)`,
  ].join('\n');
}

async function handleKeyAlarmScan(): Promise<void> {
  const { keyAlarmMaxKeys, alertEmail } = config.observability;
  const { searchKeys, videosKeys, shouldAlarm } = evaluateKeyAlarm(process.env, keyAlarmMaxKeys);
  log.info(
    `key-alarm scan: search_keys=${searchKeys} videos_keys=${videosKeys} ` +
      `threshold=${keyAlarmMaxKeys} alarm=${shouldAlarm}`
  );
  if (!shouldAlarm) return;
  if (!alertEmail) {
    log.warn(
      `key-alarm: ${searchKeys} active SEARCH keys (> ${keyAlarmMaxKeys}) but ` +
        `OBSERVABILITY_ALERT_EMAIL is unset — email skipped`
    );
    return;
  }
  try {
    await transporter.sendMail({
      from: config.gmail.smtpFrom,
      to: alertEmail,
      subject: `🔴 Insighta ops: ${searchKeys} active YouTube SEARCH keys (ToS ban risk)`,
      text: buildKeyAlarmText(searchKeys, videosKeys, keyAlarmMaxKeys),
    });
    log.info(`key-alarm: email sent to ${alertEmail} (search_keys=${searchKeys})`);
  } catch (err) {
    log.warn(
      `key-alarm: email send failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

/** Register the key-alarm worker + daily schedule. Call after JobQueue.start(). */
export async function registerKeyAlarmWorker(): Promise<void> {
  const boss = getJobQueue().getInstance();
  await boss.work(JOB_NAMES.KEY_ALARM_SCAN, handleKeyAlarmScan);
  await boss.schedule(JOB_NAMES.KEY_ALARM_SCAN, QUEUE_CONFIG.KEY_ALARM_CRON);
  log.info(`key-alarm worker registered + scheduled (cron=${QUEUE_CONFIG.KEY_ALARM_CRON})`);
}
