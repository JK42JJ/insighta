/**
 * Beta-tester benefit email — content contract.
 *
 * James 2026-07-15: beta testers get an UNLIMITED tier (lifetime), and the
 * email leads with FEATURES the product actually ships — not quota counts.
 * Numbers that no code enforces (aiSummaries/richSummaries) and false counts
 * (notes are 1-per-mandala) must never appear. A manual tier change carries no
 * payment, so the copy must say so.
 */

import { buildProUpgradeEmail } from '../../../src/modules/email/templates';

describe('buildProUpgradeEmail', () => {
  it('announces unlimited + real features, no false counts', () => {
    const { subject, html } = buildProUpgradeEmail({});
    expect(subject).toContain('제한 없이');
    expect(html).toContain('PRO');
    // Unlimited framing (beta perk via lifetime tier) + the real features
    // James asked for: summary, auto note, the new mobile app, early access.
    expect(html).toContain('무제한');
    expect(html).toContain('AI 요약');
    expect(html).toContain('다이얼');
    expect(html).toContain('신규 기능 우선 제공');
    // Never promise an unenforced count or a per-note count (notes are
    // 1-per-mandala). These would be lies.
    expect(html).not.toMatch(/AI 요약[^<]*\d+\s*회/);
    expect(html).not.toMatch(/노트 \d+권/);
    expect(html).not.toContain('만다라 20개');
    // No payment is attached to a manual tier change — the copy must say so.
    expect(html).toContain('자동 결제되지 않아요');
    // CTA lands on the app, not the pre-signup login funnel.
    expect(html).toContain('https://insighta.one/');
  });

  it('escapes the member name and tolerates a missing one', () => {
    const withXss = buildProUpgradeEmail({ name: '<script>x</script>' });
    expect(withXss.html).not.toContain('<script>');
    expect(withXss.html).toContain('&lt;script&gt;');
    expect(buildProUpgradeEmail({}).html).toContain('이제');
  });
});
