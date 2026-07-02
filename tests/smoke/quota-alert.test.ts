/**
 * G5 quota-alert — failure-time email on all-keys-quota-exhausted.
 *
 * Placed in tests/smoke/ deliberately: CI's backend test step runs ONLY
 * --testPathPattern=tests/smoke (ci.yml:125), so a test outside this dir is
 * never executed by CI (PR #1055 finding).
 */

const sendMail = jest.fn();
const mockConfig = {
  observability: { alertEmail: '' },
  gmail: { smtpFrom: 'noreply@insighta.one' },
};

jest.mock('@/modules/skills/mailer', () => ({ transporter: { sendMail: (...a: unknown[]) => sendMail(...a) } }));
jest.mock('@/config/index', () => ({ config: mockConfig }));
jest.mock('@/utils/logger', () => ({
  logger: { child: () => ({ info: jest.fn(), warn: jest.fn() }) },
}));

import {
  notifyQuotaExhausted,
  _resetQuotaAlertThrottleForTest,
  QUOTA_ALERT_MIN_INTERVAL_MS,
} from '@/modules/quota-alert';

const INPUT = { api: 'search.list', keysTried: 8, lastError: 'search.list HTTP 403: quotaExceeded' };

describe('quota-alert — failure-time notify', () => {
  beforeEach(() => {
    sendMail.mockReset();
    sendMail.mockResolvedValue(undefined);
    mockConfig.observability.alertEmail = '';
    _resetQuotaAlertThrottleForTest();
  });

  it('inert when OBSERVABILITY_ALERT_EMAIL is unset (today-behavior default)', async () => {
    await expect(notifyQuotaExhausted(INPUT)).resolves.toBe('inert');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('sends to the configured inbox with counts only (no key values)', async () => {
    mockConfig.observability.alertEmail = 'admin@insighta.one';
    await expect(notifyQuotaExhausted(INPUT)).resolves.toBe('sent');
    expect(sendMail).toHaveBeenCalledTimes(1);
    const arg = sendMail.mock.calls[0][0] as { to: string; subject: string; text: string };
    expect(arg.to).toBe('admin@insighta.one');
    expect(arg.subject).toContain('ALL 8 key(s) quota-exhausted');
    expect(arg.text).toContain('quotaExceeded');
  });

  it('throttles a burst — second exhaustion within the window sends nothing', async () => {
    mockConfig.observability.alertEmail = 'admin@insighta.one';
    await expect(notifyQuotaExhausted(INPUT)).resolves.toBe('sent');
    await expect(notifyQuotaExhausted(INPUT)).resolves.toBe('throttled');
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(QUOTA_ALERT_MIN_INTERVAL_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });

  it('never throws when SMTP fails (fire-and-forget contract)', async () => {
    mockConfig.observability.alertEmail = 'admin@insighta.one';
    sendMail.mockRejectedValueOnce(new Error('SMTP down'));
    await expect(notifyQuotaExhausted(INPUT)).resolves.toBe('send_failed');
  });
});
