/**
 * cloud-posture judgement, exercised without AWS. readPostureFacts() is the
 * only part that talks to the account; evaluatePosture() is what decides,
 * so these cases pin the decision for every fact the baseline depends on.
 */
import {
  EXPECTED_ALARMS,
  MIN_PASSWORD_LENGTH,
  emptyFacts,
  evaluatePosture,
  type PostureFacts,
} from '../../../scripts/keel/check-cloud-posture';

const PREFIX = 'insighta';

function intact(): PostureFacts {
  return {
    ...emptyFacts(),
    trailLogging: true,
    trailMultiRegion: true,
    trailValidation: true,
    alarms: EXPECTED_ALARMS.map((k) => ({ name: `${PREFIX}-${k}`, actionsEnabled: true })),
    ebsEncryptionByDefault: true,
    passwordMinLength: MIN_PASSWORD_LENGTH,
    auditBucketPublicBlocked: true,
    snsConfirmed: 1,
    snsPending: 0,
  };
}

describe('cloud-posture: evaluatePosture', () => {
  it('passes when every baseline fact holds', () => {
    const v = evaluatePosture(intact(), PREFIX);
    expect(v.ok).toBe(true);
    expect(v.detail).toContain('baseline intact');
    expect(v.context['missingAlarms']).toEqual([]);
  });

  it('fails when the trail stopped logging', () => {
    const v = evaluatePosture({ ...intact(), trailLogging: false }, PREFIX);
    expect(v.ok).toBe(false);
    expect(v.detail).toContain('trail not logging');
  });

  it('names missing and disabled alarms', () => {
    const alarms = intact().alarms.filter((a) => a.name !== `${PREFIX}-root-account-use`);
    const idx = alarms.findIndex((a) => a.name === `${PREFIX}-network-changes`);
    alarms[idx] = { name: `${PREFIX}-network-changes`, actionsEnabled: false };
    const v = evaluatePosture({ ...intact(), alarms }, PREFIX);
    expect(v.ok).toBe(false);
    expect(v.detail).toContain('alarms missing: root-account-use');
    expect(v.detail).toContain('alarm actions disabled: network-changes');
  });

  it('fails while the alert subscription is still pending confirmation', () => {
    const v = evaluatePosture({ ...intact(), snsConfirmed: 0, snsPending: 1 }, PREFIX);
    expect(v.ok).toBe(false);
    expect(v.detail).toContain('no confirmed subscription (pending 1)');
  });

  it('treats an absent or weak password policy as a failure', () => {
    expect(evaluatePosture({ ...intact(), passwordMinLength: 0 }, PREFIX).detail).toContain(
      'no account password policy'
    );
    expect(evaluatePosture({ ...intact(), passwordMinLength: 8 }, PREFIX).detail).toContain(
      `password min length 8 < ${MIN_PASSWORD_LENGTH}`
    );
  });

  it('counts a fact that could not be read as a failure, not a pass', () => {
    const v = evaluatePosture(
      { ...intact(), ebsEncryptionByDefault: null, errors: ['ebs: AccessDenied'] },
      PREFIX
    );
    expect(v.ok).toBe(false);
    expect(v.detail).toContain('EBS default encryption unknown');
    expect(v.detail).toContain('read failed: ebs: AccessDenied');
  });

  it('fails when the audit bucket is not fully blocked from public access', () => {
    const v = evaluatePosture({ ...intact(), auditBucketPublicBlocked: false }, PREFIX);
    expect(v.detail).toContain('audit bucket public access not fully blocked');
  });
});
