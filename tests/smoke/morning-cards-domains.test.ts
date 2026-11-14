import {
  MORNING_CARD_DOMAINS,
  MORNING_CARD_DOMAIN_KEYS,
  isMorningCardDomainKey,
} from '../../src/modules/morning-cards/domains';
import { CURATION_DOMAINS } from '../../src/modules/curation/domain-taxonomy';

describe('morning-cards domains', () => {
  it('has exactly three domain keys', () => {
    expect(MORNING_CARD_DOMAIN_KEYS).toHaveLength(3);
  });

  it('maps every value to a member of CURATION_DOMAINS', () => {
    for (const d of Object.values(MORNING_CARD_DOMAINS)) {
      expect(d.curationDomains.length).toBeGreaterThan(0);
      for (const c of d.curationDomains) expect(CURATION_DOMAINS).toContain(c);
    }
  });

  it('validates keys', () => {
    expect(isMorningCardDomainKey('ai_tools')).toBe(true);
    expect(isMorningCardDomainKey('toString')).toBe(false);
  });
});
