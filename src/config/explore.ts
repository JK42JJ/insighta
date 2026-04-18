/**
 * Explore Feature Constants
 *
 * SSOT for explore page validation, pagination, and cache configuration.
 * Do NOT hardcode explore values elsewhere — import from this module.
 */

import { MS_PER_HOUR } from '@/utils/time-constants';

export const EXPLORE_SOURCES = ['all', 'template', 'community'] as const;
export type ExploreSource = (typeof EXPLORE_SOURCES)[number];

export const EXPLORE_SORTS = ['popular', 'recent', 'cloned'] as const;
export type ExploreSort = (typeof EXPLORE_SORTS)[number];

export const EXPLORE_LANGUAGES = ['ko', 'en'] as const;
export type ExploreLanguage = (typeof EXPLORE_LANGUAGES)[number];

/** Maximum items per page for explore endpoint */
export const EXPLORE_PAGE_LIMIT = 50;

/** Default items per page when not specified */
export const EXPLORE_DEFAULT_PAGE_SIZE = 24;

/** General pagination upper bound (shared across mandala routes) */
export const MAX_PAGINATION_LIMIT = 100;

/** Cache TTL for explore results in milliseconds (1 hour — templates are near-immutable) */
export const EXPLORE_CACHE_TTL_MS = MS_PER_HOUR;
