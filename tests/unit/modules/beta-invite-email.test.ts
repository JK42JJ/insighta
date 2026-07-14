/**
 * Beta invite email — content contract.
 *
 * Service-planning correction (2026-07-14): the mark-invited moment is
 * PRE-signup. The email must announce the invitation, drive signup with the
 * applied email, and carry the onboarding guide — the post-signup welcome
 * template was the wrong tone for this moment.
 */

import { buildBetaInviteEmail, buildWelcomeEmail } from '../../../src/modules/email/templates';

describe('buildBetaInviteEmail', () => {
  it('announces the invite, drives signup, and carries onboarding', () => {
    const { subject, html } = buildBetaInviteEmail({ goal: '토플 성적 100점 달성' });
    expect(subject).toContain('초대');
    // Signup CTA — invite gate matches on the applied email at /login.
    expect(html).toContain('https://insighta.one/login');
    expect(html).toContain('신청하신 이메일로 로그인');
    // Onboarding guide travels in the same email.
    expect(html).toContain('목표 하나를 정하기');
    expect(html).toContain('노트가 저절로');
    // Applicant's goal is echoed back.
    expect(html).toContain('토플 성적 100점 달성');
    expect(html).toContain('INVITED');
  });

  it('escapes the applicant goal and tolerates a missing one', () => {
    const withXss = buildBetaInviteEmail({ goal: '<script>x</script>' });
    expect(withXss.html).not.toContain('<script>');
    expect(withXss.html).toContain('&lt;script&gt;');
    const without = buildBetaInviteEmail({});
    expect(without.html).toContain('https://insighta.one/login');
    expect(without.html).not.toContain('남겨주신 학습 목표');
  });

  it('welcome template keeps the post-signup tone (no invite subject)', () => {
    expect(buildWelcomeEmail({}).subject).not.toContain('초대');
  });
});
