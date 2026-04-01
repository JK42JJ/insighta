export const MANDALA_DOMAINS = [
  'tech',
  'learning',
  'health',
  'business',
  'finance',
  'social',
  'creative',
  'lifestyle',
  'mind',
] as const;

export type MandalaDomain = (typeof MANDALA_DOMAINS)[number];

export interface DomainStyle {
  label: string;
  labelEn: string;
  color: string; // hex — inline style용
  dim: string; // rgba — inline style용
}

export const DOMAIN_STYLES: Record<MandalaDomain, DomainStyle> = {
  tech: {
    label: '기술/개발',
    labelEn: 'Tech/Dev',
    color: '#818cf8',
    dim: 'rgba(129,140,248,0.10)',
  },
  learning: {
    label: '학습/교육',
    labelEn: 'Learning',
    color: '#2dd4bf',
    dim: 'rgba(45,212,191,0.10)',
  },
  health: {
    label: '건강/피트니스',
    labelEn: 'Health',
    color: '#34d399',
    dim: 'rgba(52,211,153,0.10)',
  },
  business: {
    label: '비즈니스',
    labelEn: 'Business',
    color: '#fb7185',
    dim: 'rgba(251,113,133,0.10)',
  },
  finance: {
    label: '재테크/투자',
    labelEn: 'Finance',
    color: '#fbbf24',
    dim: 'rgba(251,191,36,0.08)',
  },
  social: { label: '인간관계', labelEn: 'Social', color: '#f472b6', dim: 'rgba(244,114,182,0.10)' },
  creative: {
    label: '창작/예술',
    labelEn: 'Creative',
    color: '#a78bfa',
    dim: 'rgba(167,139,250,0.10)',
  },
  lifestyle: {
    label: '라이프스타일',
    labelEn: 'Lifestyle',
    color: '#38bdf8',
    dim: 'rgba(56,189,248,0.10)',
  },
  mind: { label: '마인드', labelEn: 'Mind', color: '#a3e635', dim: 'rgba(163,230,53,0.08)' },
};

/** Get localized domain label */
export function getDomainLabel(domain: MandalaDomain, lang: string): string {
  const ds = DOMAIN_STYLES[domain];
  if (!ds) return domain;
  return lang.startsWith('ko') ? ds.label : ds.labelEn;
}

/** CSS 변수 주입용 style 객체 생성 */
export function domainCssVars(domain: MandalaDomain | null): React.CSSProperties {
  if (!domain || !DOMAIN_STYLES[domain]) return {};
  const s = DOMAIN_STYLES[domain];
  return { '--d-color': s.color, '--d-dim': s.dim } as React.CSSProperties;
}
