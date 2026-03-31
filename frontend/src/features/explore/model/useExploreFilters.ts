import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { ExploreFilters } from '@/shared/types/explore';
import { DEFAULT_EXPLORE_FILTERS } from '@/shared/types/explore';
import { MANDALA_DOMAINS, type MandalaDomain } from '@/shared/config/domain-colors';

const VALID_SOURCES = ['all', 'template', 'community'] as const;
const VALID_SORTS = ['popular', 'recent', 'cloned'] as const;

type Source = (typeof VALID_SOURCES)[number];
type Sort = (typeof VALID_SORTS)[number];

function isValidDomain(v: string | null): v is MandalaDomain {
  return v !== null && (MANDALA_DOMAINS as readonly string[]).includes(v);
}

function isValidSource(v: string | null): v is Source {
  return v !== null && (VALID_SOURCES as readonly string[]).includes(v);
}

function isValidSort(v: string | null): v is Sort {
  return v !== null && (VALID_SORTS as readonly string[]).includes(v);
}

export function useExploreFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters: ExploreFilters = useMemo(() => {
    const q = searchParams.get('q') ?? '';
    const domainParam = searchParams.get('domain');
    const sourceParam = searchParams.get('source');
    const sortParam = searchParams.get('sort');
    const pageParam = searchParams.get('page');

    return {
      q,
      domain: isValidDomain(domainParam) ? domainParam : 'all',
      source: isValidSource(sourceParam) ? sourceParam : 'all',
      sort: isValidSort(sortParam) ? sortParam : 'popular',
      page: pageParam ? Math.max(1, parseInt(pageParam, 10) || 1) : 1,
    };
  }, [searchParams]);

  const updateFilters = useCallback(
    (updates: Partial<ExploreFilters>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        const merged = { ...filters, ...updates };

        // Reset page to 1 when changing filters (not when paginating)
        if (!('page' in updates)) {
          merged.page = 1;
        }

        // Only set non-default values in URL
        if (merged.q) next.set('q', merged.q);
        else next.delete('q');

        if (merged.domain !== DEFAULT_EXPLORE_FILTERS.domain) next.set('domain', merged.domain);
        else next.delete('domain');

        if (merged.source !== DEFAULT_EXPLORE_FILTERS.source) next.set('source', merged.source);
        else next.delete('source');

        if (merged.sort !== DEFAULT_EXPLORE_FILTERS.sort) next.set('sort', merged.sort);
        else next.delete('sort');

        if (merged.page > 1) next.set('page', String(merged.page));
        else next.delete('page');

        return next;
      });
    },
    [filters, setSearchParams]
  );

  return { filters, updateFilters };
}
