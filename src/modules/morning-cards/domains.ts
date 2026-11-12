/**
 * The three PRD #1788 morning-card domains, mapped onto the existing
 * curation taxonomy (not redeclared).
 */
import type { CurationDomain } from '../curation/domain-taxonomy';

export type MorningCardDomainKey = 'work_practice' | 'startup_gov_support' | 'ai_tools';

export interface MorningCardDomain {
  key: MorningCardDomainKey;
  label: string;
  curationDomains: readonly CurationDomain[];
}

export const MORNING_CARD_DOMAINS: Readonly<Record<MorningCardDomainKey, MorningCardDomain>> =
  Object.freeze({
    work_practice: {
      key: 'work_practice',
      label: '업무 실무',
      curationDomains: ['career'],
    },
    startup_gov_support: {
      key: 'startup_gov_support',
      label: '창업·정부 지원',
      curationDomains: ['startup', 'policy'],
    },
    ai_tools: {
      key: 'ai_tools',
      label: 'AI 도구',
      curationDomains: ['ai_ml'],
    },
  });

export const MORNING_CARD_DOMAIN_KEYS = Object.keys(MORNING_CARD_DOMAINS) as MorningCardDomainKey[];

export function isMorningCardDomainKey(v: unknown): v is MorningCardDomainKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(MORNING_CARD_DOMAINS, v);
}
