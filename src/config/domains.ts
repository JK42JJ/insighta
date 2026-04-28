/**
 * Domain SSOT — promoted to src/config/ at CP437 (2026-04-29).
 *
 * 9 fixed top-level domain slugs covering the entire Insighta knowledge
 * taxonomy. The single source of truth for:
 *   - `user_mandalas.domain` (lowercase slug, 9 distinct values)
 *   - `mandala_embeddings.domain` (KO/EN paired labels)
 *   - `video_pool_domain_tags.domain` (KO labels + 'user-derived' marker)
 *   - V4 dataset pipeline (`scripts/dataset-v4/config.ts` re-exports here)
 *   - Future v2 rich-summary `core.domain` field
 *
 * Two-tier structure reserved (`DomainSubSlug` placeholder) — current data
 * uses top-level only.
 *
 * Label policy (CP437 decision C-1, 2026-04-29):
 *   - prod labels preserved verbatim. mandala_embeddings holds ~17,985
 *     KO/EN paired rows using these exact strings. Renaming the labels
 *     (e.g. 'Mind/Spirituality' → 'Mindset/Mental Health') would force a
 *     ~3K row backfill for cosmetic improvement, so the labels stay.
 *
 * Migration policy: any new prod table column referring to a domain MUST
 * import `DomainSlug` from this file rather than redeclaring the enum.
 */

export const DOMAIN_SLUGS = [
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

export type DomainSlug = (typeof DOMAIN_SLUGS)[number];

/**
 * Reserved for future 2-tier expansion (sub-domain slugs). Keep as `never`
 * until the data path is wired up so callers cannot accidentally narrow
 * against an empty type.
 */
export type DomainSubSlug = never;

export const DOMAIN_LABEL_KO: Record<DomainSlug, string> = {
  tech: '기술/개발',
  learning: '학습/교육',
  health: '건강/피트니스',
  business: '비즈니스/커리어',
  finance: '재테크/투자',
  social: '인간관계/커뮤니티',
  creative: '창작/예술',
  lifestyle: '라이프스타일/여행',
  mind: '마인드/영성',
};

export const DOMAIN_LABEL_EN: Record<DomainSlug, string> = {
  tech: 'Tech/Development',
  learning: 'Learning/Education',
  health: 'Health/Fitness',
  business: 'Business/Career',
  finance: 'Finance/Investment',
  social: 'Relationships/Community',
  creative: 'Creative/Arts',
  lifestyle: 'Lifestyle/Travel',
  mind: 'Mind/Spirituality',
};

/** KO/EN label → slug, both directions covered. Symmetric to DOMAIN_LABEL_KO/EN. */
export const DOMAIN_LABEL_TO_SLUG: Record<string, DomainSlug> = {
  '기술/개발': 'tech',
  '학습/교육': 'learning',
  '건강/피트니스': 'health',
  '비즈니스/커리어': 'business',
  '재테크/투자': 'finance',
  '인간관계/커뮤니티': 'social',
  '창작/예술': 'creative',
  '라이프스타일/여행': 'lifestyle',
  '마인드/영성': 'mind',
  'Tech/Development': 'tech',
  'Learning/Education': 'learning',
  'Health/Fitness': 'health',
  'Business/Career': 'business',
  'Finance/Investment': 'finance',
  'Relationships/Community': 'social',
  'Creative/Arts': 'creative',
  'Lifestyle/Travel': 'lifestyle',
  'Mind/Spirituality': 'mind',
};

export function isDomainSlug(value: string | null | undefined): value is DomainSlug {
  return typeof value === 'string' && (DOMAIN_SLUGS as readonly string[]).includes(value);
}

/**
 * Legacy aliases — `scripts/dataset-v4/config.ts` re-exports these names.
 * Prefer the canonical `DOMAIN_SLUGS` / `DOMAIN_LABEL_KO` / `DOMAIN_LABEL_EN`
 * in new code; the aliases exist only so the existing dataset pipeline
 * imports keep compiling without rename.
 */
export const DOMAINS = DOMAIN_SLUGS;
export const DOMAIN_SLUG_TO_LABEL_KO = DOMAIN_LABEL_KO;
export const DOMAIN_SLUG_TO_LABEL_EN = DOMAIN_LABEL_EN;
