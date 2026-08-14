import { isV2AutoEnrichEnabled } from '@/config/v2-auto-enrich';

describe('isV2AutoEnrichEnabled', () => {
  it('defaults to true when unset (legacy behavior)', () => {
    expect(isV2AutoEnrichEnabled({} as NodeJS.ProcessEnv)).toBe(true);
  });
  it('stays true on arbitrary values', () => {
    expect(isV2AutoEnrichEnabled({ V2_AUTO_ENRICH_ENABLED: 'yes' } as NodeJS.ProcessEnv)).toBe(
      true
    );
    expect(isV2AutoEnrichEnabled({ V2_AUTO_ENRICH_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(
      true
    );
  });
  it('pauses only on explicit false/0/no', () => {
    expect(isV2AutoEnrichEnabled({ V2_AUTO_ENRICH_ENABLED: 'false' } as NodeJS.ProcessEnv)).toBe(
      false
    );
    expect(isV2AutoEnrichEnabled({ V2_AUTO_ENRICH_ENABLED: '0' } as NodeJS.ProcessEnv)).toBe(false);
    expect(isV2AutoEnrichEnabled({ V2_AUTO_ENRICH_ENABLED: 'no' } as NodeJS.ProcessEnv)).toBe(
      false
    );
  });
});
