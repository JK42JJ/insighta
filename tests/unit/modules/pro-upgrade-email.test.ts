/**
 * Beta-tester Pro upgrade email — content contract.
 *
 * The benefit numbers must quote TIER_LIMITS (src/config/quota.ts): the email
 * promises what the pro tier actually unlocks, nothing more. A manual tier
 * change carries no payment, so the copy must say so.
 */

import { buildProUpgradeEmail } from '../../../src/modules/email/templates';
import { TIER_LIMITS } from '../../../src/config/quota';

describe('buildProUpgradeEmail', () => {
  it('announces the upgrade with only ENFORCED benefits', () => {
    const { subject, html } = buildProUpgradeEmail({});
    expect(subject).toContain('Pro');
    expect(html).toContain('PRO');
    // Enforced limits only: mandala_limit (mandala/manager.ts) and
    // local_cards_limit (local-cards EF). Numbers pinned to TIER_LIMITS.
    const proCards = TIER_LIMITS.pro.cards;
    expect(proCards).not.toBeNull();
    expect(html).toContain(`만다라 ${TIER_LIMITS.pro.mandalas}개`);
    expect(html).toContain(`카드 ${(proCards as number).toLocaleString('en-US')}장`);
    expect(html).toContain('신규 기능 우선 제공');
    // aiSummaries/richSummaries are config-only (no enforcement code) —
    // promising them would be a lie. Notes are 1-per-mandala, never a count.
    expect(html).not.toContain('AI 요약');
    expect(html).not.toMatch(/노트 \d+권/);
    // No payment is attached to a manual tier change — the copy must say so.
    expect(html).toContain('자동 결제되지 않아요');
    // CTA lands on the app, not the pre-signup login funnel.
    expect(html).toContain('https://insighta.one/');
  });

  it('escapes the member name and tolerates a missing one', () => {
    const withXss = buildProUpgradeEmail({ name: '<script>x</script>' });
    expect(withXss.html).not.toContain('<script>');
    expect(withXss.html).toContain('&lt;script&gt;');
    expect(buildProUpgradeEmail({}).html).toContain('계정이');
  });
});
