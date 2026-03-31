import type { MandalaDomain } from '@/shared/config/domain-colors';

/** Summary shape returned by GET /mandalas/explore */
export interface ExploreMandala {
  id: string;
  title: string;
  shareSlug: string | null;
  domain: MandalaDomain | null;
  isTemplate: boolean;
  likeCount: number;
  cloneCount: number;
  createdAt: string;
  updatedAt: string;
  author: { displayName: string; avatarInitial: string } | null;
  rootLevel: {
    centerGoal: string;
    centerLabel?: string | null;
    subjects: string[];
    subjectLabels?: string[];
  } | null;
}

/** Full mandala with all levels for 9x9 grid modal */
export interface ExploreMandalaDetail extends ExploreMandala {
  userHasLiked: boolean;
  levels: Array<{
    id: string;
    levelKey: string;
    centerGoal: string;
    subjects: string[];
    position: number;
    depth: number;
    color: string | null;
    parentLevelId: string | null;
  }>;
}

/** Filter/sort state for the explore page */
export interface ExploreFilters {
  q: string;
  domain: MandalaDomain | 'all';
  source: 'all' | 'template' | 'community';
  sort: 'popular' | 'recent' | 'cloned';
  page: number;
}

/** API response for explore list */
export interface ExploreListResponse {
  mandalas: ExploreMandala[];
  total: number;
  page: number;
  limit: number;
}

export const DEFAULT_EXPLORE_FILTERS: ExploreFilters = {
  q: '',
  domain: 'all',
  source: 'all',
  sort: 'popular',
  page: 1,
};
