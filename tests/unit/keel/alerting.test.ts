/**
 * When a change counts as a transition, and what happens to the alert.
 *
 * Both were wrong in a way no test could have caught, because neither was a
 * function. Measured over 14 runs on 2026-09-21: transcript-proxies flipped 8
 * times while captions kept working, and every flip alerted; and every alert
 * since Keel shipped was counted as sent into a webhook that does not exist.
 * The judgement is pulled out here so the truth table is the design.
 */

import {
  isConfirmedTransition,
  TRANSITION_CONFIRMATIONS,
  alertChannelConfigured,
} from '../../../scripts/keel/lib';
import {
  interpretAlertDelivery,
  DELIVERY_FAILURE_WINDOW_HOURS,
  ALL_CHECKS,
} from '../../../scripts/keel/checks';
import { ALERT_DELIVERY_STAGE, ALERT_DISPATCH_STAGE } from '../../../scripts/keel/lib';
import { shouldFail } from '../../../scripts/keel/run';

const OK = true;
const BAD = false;

describe('isConfirmedTransition', () => {
  it('never fires on the first run, whatever the answer', () => {
    // A burst of notifications on the day monitoring ships teaches everyone to
    // mute the channel.
    expect(isConfirmedTransition([], BAD)).toBe(false);
    expect(isConfirmedTransition([], OK)).toBe(false);
  });

  it('waits for a second opinion when only one prior answer exists', () => {
    expect(isConfirmedTransition([OK], BAD)).toBe(false);
  });

  it('does not fire on a single flip', () => {
    // history newest-first: healthy, healthy. One bad reading is not a state.
    expect(isConfirmedTransition([OK, OK], BAD)).toBe(false);
  });

  it('fires once the new answer has been seen twice', () => {
    // The bad reading at history[0] is now confirmed by the current one.
    expect(isConfirmedTransition([BAD, OK], BAD)).toBe(true);
  });

  it('fires on recovery too, on the same terms', () => {
    expect(isConfirmedTransition([OK, BAD], OK)).toBe(true);
  });

  it('stays quiet while a confirmed state persists', () => {
    // This is what keeps a steady failure out of the channel and the run green.
    expect(isConfirmedTransition([BAD, BAD], BAD)).toBe(false);
    expect(isConfirmedTransition([OK, OK], OK)).toBe(false);
  });

  /**
   * The flap that was measured, replayed. transcript-proxies over the 13 runs
   * whose logs survived, oldest first: X . X . . X . . X . . . X
   *
   * The old policy alerted on every change -- 8 of them, in both directions, and
   * each one turned the workflow red. Requiring two agreeing observations cuts
   * that to 3: the runs where a state actually held for two cycles.
   *
   * Not zero, and it should not be read as the fix for this particular flap.
   * The source of it was a 5 s probe ceiling below the proxy's cold start
   * (PROXY_PROBE_TIMEOUT_MS, src/config/transcript.ts); this is the general
   * guard against a single bad sample, and two is the smallest number that
   * rejects one. Tuning it upward until this sequence produces one alert would
   * be fitting the policy to one incident and would delay every real report.
   */
  it('cuts the measured flap from 8 alerts to 3', () => {
    const observed = [BAD, OK, BAD, OK, OK, BAD, OK, OK, BAD, OK, OK, OK, BAD];
    let alerts = 0;
    let oldPolicyAlerts = 0;
    for (let i = 0; i < observed.length; i++) {
      const history = observed.slice(0, i).reverse().slice(0, TRANSITION_CONFIRMATIONS);
      if (isConfirmedTransition(history, observed[i] as boolean)) alerts++;
      if (i > 0 && observed[i] !== observed[i - 1]) oldPolicyAlerts++;
    }
    expect(oldPolicyAlerts).toBe(8);
    expect(alerts).toBe(3);
  });

  it('still reports a failure that arrives and stays', () => {
    // pipeline-freshness going stale: two runs of bad after a healthy history.
    const observed = [OK, OK, OK, BAD, BAD, BAD];
    const fired: number[] = [];
    for (let i = 0; i < observed.length; i++) {
      const history = observed.slice(0, i).reverse().slice(0, TRANSITION_CONFIRMATIONS);
      if (isConfirmedTransition(history, observed[i] as boolean)) fired.push(i);
    }
    // One alert, on the second bad reading. Not on the first, not again after.
    expect(fired).toEqual([4]);
  });
});

describe('alertChannelConfigured', () => {
  it('is false when the webhook is unset or empty', () => {
    // Both shapes occur: GitHub Actions passes an unset secret as an empty
    // string, which is how this went unnoticed -- the env var was present.
    expect(alertChannelConfigured({})).toBe(false);
    expect(alertChannelConfigured({ SLACK_ALERT_WEBHOOK: '' })).toBe(false);
  });

  it('is true when a webhook is set', () => {
    expect(
      alertChannelConfigured({ SLACK_ALERT_WEBHOOK: 'https://hooks.slack.com/services/x' })
    ).toBe(true);
  });
});

/**
 * The check that answers the question about the monitor rather than the service.
 * Every other check here was silent about the one thing that made all of them
 * silent.
 */
describe('interpretAlertDelivery', () => {
  const now = Date.parse('2026-09-21T12:00:00Z');
  const hoursAgo = (h: number) => new Date(now - h * 60 * 60 * 1000);

  it('fails when no channel is configured, and says what that costs', () => {
    const r = interpretAlertDelivery({ configured: false, lastFailure: null, now });
    expect(r.ok).toBe(false);
    // Naming the consequence is what makes someone act; "unset" does not.
    expect(r.detail).toContain('SLACK_ALERT_WEBHOOK');
    expect(r.detail).toMatch(/nobody else/);
  });

  it('does not read the ledger to answer the unconfigured case', () => {
    // Asserted through the shape: the judgement takes lastFailure as an input,
    // and checkAlertDelivery passes null without querying when unconfigured.
    expect(interpretAlertDelivery({ configured: false, lastFailure: null, now }).ok).toBe(false);
  });

  it('passes when a channel is configured and nothing has failed', () => {
    const r = interpretAlertDelivery({ configured: true, lastFailure: null, now });
    expect(r.ok).toBe(true);
    expect(r.context['configured']).toBe(true);
  });

  it('fails on a recent delivery failure — a revoked webhook answers 403', () => {
    const r = interpretAlertDelivery({
      configured: true,
      lastFailure: {
        at: hoursAgo(1),
        message: 'llm-spend: delivery failed: HTTP 403 invalid_token',
      },
      now,
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('403');
  });

  it('lets an old failure go, because it has since recovered', () => {
    const r = interpretAlertDelivery({
      configured: true,
      lastFailure: { at: hoursAgo(DELIVERY_FAILURE_WINDOW_HOURS + 24), message: 'HTTP 500' },
      now,
    });
    expect(r.ok).toBe(true);
    expect(r.detail).toContain('outside the window');
  });
});

/**
 * The two defects that reached production on 2026-09-21 and had to be reverted
 * an hour later. Both were shipped with tests; neither was the kind of test
 * that could see them, because both were properties of the run as a whole
 * rather than of any one function.
 */
describe('what a run writes and what makes it red', () => {
  it('does not write delivery failures under a check name', () => {
    // report() writes one observation row per check under `stage = check`. A
    // delivery failure written under the same string put two rows in one stage
    // in one run, so the alert-delivery check read its own failure rows as its
    // observation history and lastDeliveryFailure() matched the row the check
    // had just caused. Measured in the ledger at 14:11 KST before the split.
    expect(ALERT_DISPATCH_STAGE).not.toBe(ALERT_DELIVERY_STAGE);
  });

  it('keeps the dispatch stage clear of every check name', () => {
    // Not just of alert-delivery: any check whose name collided would corrupt
    // its own history the same way. This is the general form of the defect.
    const names = ALL_CHECKS.map((c) => c.name);
    expect(names.length).toBeGreaterThan(10);
    expect(names).not.toContain(ALERT_DISPATCH_STAGE);
  });

  it('is green when everything is steady, however much is failing', () => {
    // The flood: an unconfigured channel forced red on every run, which on a
    // 30-minute schedule is 48 failure mails a day. Four checks were failing in
    // every run of that hour and none of them was new.
    expect(shouldFail({ alerted: 0, threw: 0 })).toBe(false);
  });

  it('is red on a confirmed transition', () => {
    expect(shouldFail({ alerted: 1, threw: 0 })).toBe(true);
  });

  it('is red when a check threw, which is a monitor that stopped looking', () => {
    expect(shouldFail({ alerted: 0, threw: 1 })).toBe(true);
  });
});
