/**
 * Morning cards: fields, freshness windows and pipeline thresholds.
 * Pure config — reads no environment variables.
 */

import { z } from 'zod';

export const FRESHNESS_CLASSES = ['fast', 'market', 'evergreen', 'time_bound'] as const;
export type FreshnessClass = (typeof FRESHNESS_CLASSES)[number];

export const FIELD_IDS = [
  'work_practice',
  'startup_gov_support',
  'ai_tools_dev',
  'cert_exam',
  'teaching_materials',
  'career_jobs',
  'marketing_sales',
  'management_consulting',
] as const;
export type FieldId = (typeof FIELD_IDS)[number];

const DEFAULT_FAST_DAYS = 30;
const DEFAULT_MARKET_DAYS = 90;
const DEFAULT_MIN_RELEVANCE = 60;
const DEFAULT_MAX_CARDS_PER_FIELD = 30;
const MAX_RELEVANCE = 100;

const freshnessClassSchema = z.enum(FRESHNESS_CLASSES);

const fieldSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  defaultClass: freshnessClassSchema,
});

const DEFAULT_FIELDS = [
  { id: 'work_practice', label: '업무 실무', defaultClass: 'market' },
  { id: 'startup_gov_support', label: '창업·정부 지원', defaultClass: 'time_bound' },
  { id: 'ai_tools_dev', label: 'AI 도구·개발', defaultClass: 'fast' },
  { id: 'cert_exam', label: '자격증·시험', defaultClass: 'time_bound' },
  { id: 'teaching_materials', label: '강의·교육 자료', defaultClass: 'evergreen' },
  { id: 'career_jobs', label: '취업·이직', defaultClass: 'market' },
  { id: 'marketing_sales', label: '마케팅·영업', defaultClass: 'market' },
  { id: 'management_consulting', label: '경영·컨설팅', defaultClass: 'market' },
] as const;

const DEFAULT_TIME_BOUND_KEYWORDS = [
  '지원사업',
  '바우처',
  '공고',
  '공모',
  '세법',
  '개정',
  '규제',
  '시험 일정',
  '모집',
];

export const morningCardsConfigSchema = z.object({
  fields: z.array(fieldSchema).default([...DEFAULT_FIELDS]),
  windows: z
    .object({
      fastDays: z.number().int().positive().default(DEFAULT_FAST_DAYS),
      marketDays: z.number().int().positive().default(DEFAULT_MARKET_DAYS),
      /** null = no limit. */
      evergreenDays: z.number().int().positive().nullable().default(null),
    })
    .default({}),
  /** In Jan/Feb (KST), widen the time_bound window back this many months before Jan 1. 0 = off. */
  timeBoundFallbackMonths: z.number().int().min(0).default(0),
  timeBoundKeywords: z.array(z.string().min(1)).default(DEFAULT_TIME_BOUND_KEYWORDS),
  allowedLanguages: z.array(z.string().min(1)).default(['ko']),
  minRelevance: z.number().int().min(0).max(MAX_RELEVANCE).default(DEFAULT_MIN_RELEVANCE),
  maxCardsPerField: z.number().int().positive().default(DEFAULT_MAX_CARDS_PER_FIELD),
});

export type MorningCardsConfig = z.infer<typeof morningCardsConfigSchema>;

export function parseMorningCardsConfig(input: unknown = {}): MorningCardsConfig {
  return morningCardsConfigSchema.parse(input);
}

export const morningCardsConfig: MorningCardsConfig = parseMorningCardsConfig({});

/**
 * Effective freshness class for a topic: a time-bound keyword upgrades any
 * field to `time_bound`; otherwise the field's default applies.
 * Unknown field ids fall back to `market`.
 */
export function resolveFreshnessClass(
  fieldId: string,
  topicText: string,
  config: MorningCardsConfig = morningCardsConfig
): FreshnessClass {
  const text = (topicText ?? '').toString();
  if (config.timeBoundKeywords.some((k) => text.includes(k))) return 'time_bound';
  const field = config.fields.find((f) => f.id === fieldId);
  return field ? field.defaultClass : 'market';
}
