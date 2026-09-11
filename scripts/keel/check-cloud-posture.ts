/**
 * cloud-posture: the account baseline that terraform/modules/security-baseline
 * applies must still be in place. Every fact is a read-only call the CI role
 * is allowed to make (terraform/global/iam-ci/security-read.tf) and none of
 * them costs money. Facts and judgement are split so the judgement is
 * unit-tested without AWS: readPostureFacts() collects, evaluatePosture()
 * decides. A fact that could not be read counts as a failure -- an unknown
 * posture is not a passing one.
 */
import { execSync } from 'child_process';
import type { CheckResult } from './lib';

const PREFIX = process.env['MONITOR_SECURITY_PREFIX'] ?? 'insighta';
const REGION = process.env['AWS_REGION'] ?? 'us-west-2';
const AUDIT_BUCKET = process.env['MONITOR_AUDIT_BUCKET'] ?? `${PREFIX}-audit-logs`;
const AWS_TIMEOUT_MS = 20_000;
export const MIN_PASSWORD_LENGTH = 14;

/** Keys of locals.trail_alarms in the baseline module; alarm name = `${prefix}-${key}`. */
export const EXPECTED_ALARMS = [
  'cloudtrail-changes',
  'console-login-without-mfa',
  'iam-policy-changes',
  'network-changes',
  'root-account-use',
  's3-bucket-exposure-changes',
  'security-group-structure-changes',
  'unauthorized-api-calls',
] as const;

const PUBLIC_BLOCK_FLAGS = ['BlockPublicAcls', 'IgnorePublicAcls', 'BlockPublicPolicy', 'RestrictPublicBuckets'];

export interface PostureFacts {
  /** null = the trail is missing or the call failed. */
  trailLogging: boolean | null;
  trailMultiRegion: boolean | null;
  trailValidation: boolean | null;
  alarms: Array<{ name: string; actionsEnabled: boolean }>;
  ebsEncryptionByDefault: boolean | null;
  /** 0 = no account password policy; null = could not read. */
  passwordMinLength: number | null;
  /** true only when all four public-access-block flags are on. */
  auditBucketPublicBlocked: boolean | null;
  snsConfirmed: number | null;
  snsPending: number | null;
  /** One entry per fact that could not be read. */
  errors: string[];
}

export interface PostureVerdict {
  ok: boolean;
  detail: string;
  context: Record<string, unknown>;
}

function aws(args: string): unknown {
  const out = execSync(`aws ${args} --output json`, {
    encoding: 'utf8',
    timeout: AWS_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, AWS_PAGER: '' },
  });
  return out.trim() ? (JSON.parse(out) as unknown) : null;
}

export function emptyFacts(): PostureFacts {
  return {
    trailLogging: null,
    trailMultiRegion: null,
    trailValidation: null,
    alarms: [],
    ebsEncryptionByDefault: null,
    passwordMinLength: null,
    auditBucketPublicBlocked: null,
    snsConfirmed: null,
    snsPending: null,
    errors: [],
  };
}

export function readPostureFacts(): PostureFacts {
  const f = emptyFacts();
  const attempt = (label: string, fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      f.errors.push(`${label}: ${String(err).replace(/\s+/g, ' ').slice(0, 120)}`);
    }
  };

  attempt('trail-status', () => {
    const r = aws(`cloudtrail get-trail-status --name ${PREFIX}-trail --region ${REGION}`) as { IsLogging?: boolean } | null;
    f.trailLogging = r?.IsLogging ?? null;
  });
  attempt('trail', () => {
    const r = aws(`cloudtrail get-trail --name ${PREFIX}-trail --region ${REGION}`) as {
      Trail?: { IsMultiRegionTrail?: boolean; LogFileValidationEnabled?: boolean };
    } | null;
    f.trailMultiRegion = r?.Trail?.IsMultiRegionTrail ?? null;
    f.trailValidation = r?.Trail?.LogFileValidationEnabled ?? null;
  });
  attempt('alarms', () => {
    const r = aws(`cloudwatch describe-alarms --alarm-name-prefix ${PREFIX}- --region ${REGION}`) as {
      MetricAlarms?: Array<{ AlarmName?: string; ActionsEnabled?: boolean }>;
    } | null;
    f.alarms = (r?.MetricAlarms ?? []).map((a) => ({ name: a.AlarmName ?? '', actionsEnabled: a.ActionsEnabled === true }));
  });
  attempt('ebs', () => {
    const r = aws(`ec2 get-ebs-encryption-by-default --region ${REGION}`) as { EbsEncryptionByDefault?: boolean } | null;
    f.ebsEncryptionByDefault = r?.EbsEncryptionByDefault ?? null;
  });
  try {
    const r = aws('iam get-account-password-policy') as { PasswordPolicy?: { MinimumPasswordLength?: number } } | null;
    f.passwordMinLength = r?.PasswordPolicy?.MinimumPasswordLength ?? 0;
  } catch (err) {
    // NoSuchEntity is a posture fact (no policy), not a read failure.
    if (/NoSuchEntity/.test(String(err))) f.passwordMinLength = 0;
    else f.errors.push(`password-policy: ${String(err).replace(/\s+/g, ' ').slice(0, 120)}`);
  }
  attempt('audit-bucket', () => {
    const r = aws(`s3api get-public-access-block --bucket ${AUDIT_BUCKET}`) as {
      PublicAccessBlockConfiguration?: Record<string, boolean>;
    } | null;
    const c = r?.PublicAccessBlockConfiguration;
    f.auditBucketPublicBlocked = c ? PUBLIC_BLOCK_FLAGS.every((k) => c[k] === true) : null;
  });
  attempt('alert-topic', () => {
    const account = (aws('sts get-caller-identity') as { Account?: string } | null)?.Account ?? '';
    const arn = `arn:aws:sns:${REGION}:${account}:${PREFIX}-security-alerts`;
    const r = aws(`sns get-topic-attributes --topic-arn ${arn} --region ${REGION}`) as { Attributes?: Record<string, string> } | null;
    const a = r?.Attributes ?? {};
    const confirmed = Number(a['SubscriptionsConfirmed']);
    const pending = Number(a['SubscriptionsPending']);
    f.snsConfirmed = Number.isFinite(confirmed) ? confirmed : null;
    f.snsPending = Number.isFinite(pending) ? pending : null;
  });
  return f;
}

export function evaluatePosture(f: PostureFacts, prefix: string = PREFIX): PostureVerdict {
  const failures: string[] = [];

  if (f.trailLogging === null) failures.push('trail status unknown');
  else if (!f.trailLogging) failures.push('trail not logging');
  if (f.trailMultiRegion === false) failures.push('trail not multi-region');
  if (f.trailValidation === false) failures.push('trail log file validation off');

  const byName = new Map(f.alarms.map((a) => [a.name, a.actionsEnabled] as const));
  const missing = EXPECTED_ALARMS.filter((k) => !byName.has(`${prefix}-${k}`));
  const disabled = EXPECTED_ALARMS.filter((k) => byName.get(`${prefix}-${k}`) === false);
  if (missing.length) failures.push(`alarms missing: ${missing.join(' ')}`);
  if (disabled.length) failures.push(`alarm actions disabled: ${disabled.join(' ')}`);

  if (f.ebsEncryptionByDefault === null) failures.push('EBS default encryption unknown');
  else if (!f.ebsEncryptionByDefault) failures.push('EBS default encryption off');

  if (f.passwordMinLength === null) failures.push('password policy unknown');
  else if (f.passwordMinLength === 0) failures.push('no account password policy');
  else if (f.passwordMinLength < MIN_PASSWORD_LENGTH) failures.push(`password min length ${f.passwordMinLength} < ${MIN_PASSWORD_LENGTH}`);

  if (f.auditBucketPublicBlocked === null) failures.push('audit bucket public access block unknown');
  else if (!f.auditBucketPublicBlocked) failures.push('audit bucket public access not fully blocked');

  if (f.snsConfirmed === null) failures.push('alert topic unknown');
  else if (f.snsConfirmed < 1) failures.push(`alert topic has no confirmed subscription (pending ${f.snsPending ?? 0})`);

  for (const e of f.errors) failures.push(`read failed: ${e}`);

  const ok = failures.length === 0;
  const detail = ok
    ? `baseline intact: trail logging, ${EXPECTED_ALARMS.length} alarms armed, EBS encryption on, password policy ${MIN_PASSWORD_LENGTH}+, audit bucket blocked, alert subscription confirmed`
    : failures.join(' · ');
  return {
    ok,
    detail,
    context: {
      trailLogging: f.trailLogging,
      alarms: f.alarms.length,
      missingAlarms: missing,
      disabledAlarms: disabled,
      ebsEncryptionByDefault: f.ebsEncryptionByDefault,
      passwordMinLength: f.passwordMinLength,
      auditBucketPublicBlocked: f.auditBucketPublicBlocked,
      snsConfirmed: f.snsConfirmed,
      snsPending: f.snsPending,
      errors: f.errors,
    },
  };
}

export async function checkCloudPosture(): Promise<CheckResult> {
  const check = 'cloud-posture';
  try {
    const verdict = evaluatePosture(readPostureFacts());
    return { check, ok: verdict.ok, detail: verdict.detail, context: verdict.context };
  } catch (err) {
    return { check, ok: false, detail: `posture read failed: ${String(err).slice(0, 160)}` };
  }
}
