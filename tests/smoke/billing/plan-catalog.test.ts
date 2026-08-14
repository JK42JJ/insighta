// Unit tests for plan-catalog. Module reads `billingConfig` at import time —
// we set env BEFORE importing it so the test reflects the resolved config.
export {};

const MONTHLY_VARIANT_ID = '999888777';
const YEARLY_VARIANT_ID = '111222333';

describe('plan-catalog', () => {
  beforeAll(() => {
    process.env['LEMONSQUEEZY_API_KEY'] = 'test_key';
    process.env['LEMONSQUEEZY_WEBHOOK_SECRET'] = 'test_secret';
    process.env['LEMONSQUEEZY_STORE_ID'] = '1234';
    process.env['LEMONSQUEEZY_VARIANT_ID_PRO_MONTHLY'] = MONTHLY_VARIANT_ID;
    process.env['LEMONSQUEEZY_VARIANT_ID_PRO_YEARLY'] = YEARLY_VARIANT_ID;
  });

  test('findPlanByVariantId returns pro_monthly entry for monthly variant', async () => {
    const mod = await import('../../../src/modules/billing/plan-catalog');
    const found = mod.findPlanByVariantId(MONTHLY_VARIANT_ID);
    expect(found).not.toBeNull();
    expect(found?.planCode).toBe('pro_monthly');
    expect(found?.tier).toBe('pro');
    expect(found?.cardLimit).toBe(2000);
    expect(found?.mandalaLimit).toBe(20);
  });

  test('findPlanByVariantId returns pro_yearly entry for yearly variant', async () => {
    const mod = await import('../../../src/modules/billing/plan-catalog');
    const found = mod.findPlanByVariantId(YEARLY_VARIANT_ID);
    expect(found).not.toBeNull();
    expect(found?.planCode).toBe('pro_yearly');
    expect(found?.tier).toBe('pro');
    expect(found?.cardLimit).toBe(2000);
    expect(found?.mandalaLimit).toBe(20);
  });

  test('findPlanByVariantId returns null for unknown variant', async () => {
    const mod = await import('../../../src/modules/billing/plan-catalog');
    expect(mod.findPlanByVariantId('unregistered_variant')).toBeNull();
  });

  test('findPlanByCode finds by internal plan_code (monthly + yearly)', async () => {
    const mod = await import('../../../src/modules/billing/plan-catalog');
    expect(mod.findPlanByCode('pro_monthly')?.variantId).toBe(MONTHLY_VARIANT_ID);
    expect(mod.findPlanByCode('pro_yearly')?.variantId).toBe(YEARLY_VARIANT_ID);
    expect(mod.findPlanByCode('does_not_exist')).toBeNull();
  });

  test('getCatalog returns both entries when both variants configured', async () => {
    const mod = await import('../../../src/modules/billing/plan-catalog');
    const catalog = mod.getCatalog();
    expect(catalog).toHaveLength(2);
    expect(catalog.map((e) => e.planCode).sort()).toEqual(['pro_monthly', 'pro_yearly']);
  });
});
