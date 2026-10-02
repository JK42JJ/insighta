/**
 * Keel's settings, read from the environment at call time.
 *
 * Read lazily rather than parsed once at import: the same module runs in two
 * places -- the in-cluster CronJob, where the values come from the
 * `insighta-env` secret, and the daily GitHub run, where the workflow sets them
 * -- and the tests set them per case. Every default is the behaviour the
 * checks had before they moved here, so an unset variable changes nothing.
 */

const num = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export const keelConfig = {
  /** Where the service is probed. The CronJob points this at the in-cluster api service. */
  baseUrl: (): string => process.env['MONITOR_BASE_URL'] ?? 'https://insighta.one',
  llmDailyLimitUsd: (): number => num('LLM_DAILY_COST_LIMIT_USD', 10),
  llmMonthlyLimitUsd: (): number => num('LLM_MONTHLY_COST_LIMIT_USD', 50),
  spendWarnRatio: (): number => num('MONITOR_SPEND_WARN_RATIO', 0.7),
  /** Unset is a real state ("nobody can be told"), not an error. */
  slackWebhook: (): string => process.env['SLACK_ALERT_WEBHOOK'] ?? '',
};
