/**
 * G5 — quota/ban FAILURE-time alert (companion to the daily key-COUNT alarm,
 * queue/handlers/key-alarm.ts Phase 2-A).
 *
 * The key-alarm job counts configured keys once a day; it cannot tell the
 * operator that the pool just DIED. This module fires when the search.list
 * rotation exhausts ALL keys (every key answered 403/429) — the exact moment
 * the 8→1 key consolidation makes silent: with one key there is no rotation
 * left to hide behind, so an unnoticed quota/ban outage becomes user-facing.
 *
 * Contract:
 *   - Inert when OBSERVABILITY_ALERT_EMAIL is unset (same convention as
 *     key-alarm / search-metrics-report — no new env, unset = today's behavior).
 *   - Fire-and-forget: never throws, never awaited by the serving path
 *     (poll/await on this would insert SMTP latency into wizard search —
 *     CP501 poll-dependency lesson).
 *   - Throttled in-process: at most one email per QUOTA_ALERT_MIN_INTERVAL_MS
 *     so a burst of exhausted searches cannot mail-storm the operator.
 *   - No key VALUES are ever included — counts and error text only.
 */

import { config } from '@/config/index';
import { logger } from '@/utils/logger';
import { transporter } from '@/modules/skills/mailer';

const log = logger.child({ module: 'quota-alert' });

/** Min gap between alert emails (6h) — burst of exhausted calls = 1 mail. */
export const QUOTA_ALERT_MIN_INTERVAL_MS = 6 * 60 * 60 * 1000;

let lastSentAtMs = 0;

/** Test seam — reset the throttle window. */
export function _resetQuotaAlertThrottleForTest(): void {
  lastSentAtMs = 0;
}

export interface QuotaExhaustedInput {
  /** Which API pool died (e.g. 'search.list'). */
  api: string;
  /** How many keys the rotation tried before giving up. */
  keysTried: number;
  /** Last provider error message (no key material — API error text only). */
  lastError: string;
}

/**
 * Decide-and-send. Returns what happened so tests can pin the logic:
 * 'sent' | 'throttled' | 'inert' | 'send_failed'.
 */
export async function notifyQuotaExhausted(input: QuotaExhaustedInput): Promise<string> {
  const to = config.observability.alertEmail;
  if (!to) {
    log.warn(
      `quota-alert: ${input.api} exhausted all ${input.keysTried} key(s) but ` +
        `OBSERVABILITY_ALERT_EMAIL is unset — email skipped`
    );
    return 'inert';
  }
  const now = Date.now();
  if (now - lastSentAtMs < QUOTA_ALERT_MIN_INTERVAL_MS) return 'throttled';
  lastSentAtMs = now;
  try {
    await transporter.sendMail({
      from: config.gmail.smtpFrom,
      to,
      subject: `🔴 Insighta ops: YouTube ${input.api} — ALL ${input.keysTried} key(s) quota-exhausted`,
      text: [
        `🔴 Insighta ops alarm — YouTube quota exhausted at failure time`,
        ``,
        `API: ${input.api}`,
        `Keys tried (rotation): ${input.keysTried} — every one answered 403/429.`,
        `Last provider error: ${input.lastError.slice(0, 300)}`,
        ``,
        `User impact: live search fanout returns 0 items until quota resets`,
        `(midnight PT) or the key/quota is fixed. Pool-serve/cosine paths are`,
        `unaffected. If this is a single-key setup (post 8→1 consolidation),`,
        `check the Google Cloud project for a quota bump or a ban notice.`,
        ``,
        `(Throttled: at most one of these emails per ${QUOTA_ALERT_MIN_INTERVAL_MS / 3600000}h.`,
        ` No key values are transmitted.)`,
      ].join('\n'),
    });
    log.info(`quota-alert: email sent to ${to} (api=${input.api}, keys_tried=${input.keysTried})`);
    return 'sent';
  } catch (err) {
    log.warn(
      `quota-alert: email send failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`
    );
    return 'send_failed';
  }
}
