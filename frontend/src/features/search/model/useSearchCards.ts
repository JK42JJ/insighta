import { useQuery } from '@tanstack/react-query';
import { useState, useMemo, useCallback } from 'react';
import { getAuthHeaders, getEdgeFunctionUrl } from '@/shared/lib/supabase-auth';
import { useAuth } from '@/features/auth/model/useAuth';
import type { LocalCard } from '@/entities/card/model/local-cards';
import type { InsightCard } from '@/entities/card/model/types';
import { localCardToInsightCard } from '@/entities/card/model/local-cards';
import { useDebounce } from '@/shared/lib/useDebounce';

interface SearchResponse {
  cards: LocalCard[];
  total: number;
}

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 30;

export type SourceFilter = 'all' | 'youtube' | 'link' | 'file';

const YOUTUBE_TYPES = new Set(['youtube', 'youtube-shorts', 'youtube-playlist']);
const FILE_TYPES = new Set(['txt', 'md', 'pdf']);

export const searchKeys = {
  all: ['search'] as const,
  query: (q: string) => [...searchKeys.all, q] as const,
};

export function useSearchCards() {
  const { isLoggedIn, isTokenReady } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const debouncedQuery = useDebounce(searchTerm, SEARCH_DEBOUNCE_MS);
  const isSearchActive = debouncedQuery.length > 0;

  const query = useQuery({
    queryKey: searchKeys.query(debouncedQuery),
    queryFn: async (): Promise<SearchResponse> => {
      const headers = await getAuthHeaders();
      const url = getEdgeFunctionUrl('local-cards', 'search') +
        `&q=${encodeURIComponent(debouncedQuery)}&limit=${SEARCH_LIMIT}`;
      const response = await fetch(url, { headers });

      if (!response.ok) {
        throw new Error('Search failed');
      }

      return response.json();
    },
    enabled: isLoggedIn && isTokenReady && isSearchActive,
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Client-side source type filtering
  const allResults = useMemo(
    () => query.data?.cards.map(localCardToInsightCard) ?? [],
    [query.data?.cards]
  );

  const results = useMemo(() => {
    if (sourceFilter === 'all') return allResults;
    return allResults.filter((card) => {
      const lt = card.linkType ?? 'other';
      switch (sourceFilter) {
        case 'youtube': return YOUTUBE_TYPES.has(lt);
        case 'file': return FILE_TYPES.has(lt);
        case 'link': return !YOUTUBE_TYPES.has(lt) && !FILE_TYPES.has(lt);
        default: return true;
      }
    });
  }, [allResults, sourceFilter]);

  // Reset highlight when results change
  const setSearchTermAndReset = useCallback((term: string) => {
    setSearchTerm(term);
    setHighlightIndex(-1);
  }, []);

  const clearSearch = useCallback(() => {
    setSearchTerm('');
    setSourceFilter('all');
    setHighlightIndex(-1);
  }, []);

  // Keyboard navigation helpers
  const moveHighlight = useCallback((direction: 'up' | 'down') => {
    setHighlightIndex((prev) => {
      if (results.length === 0) return -1;
      if (direction === 'down') {
        return prev < results.length - 1 ? prev + 1 : 0;
      }
      return prev > 0 ? prev - 1 : results.length - 1;
    });
  }, [results.length]);

  const getHighlightedCard = useCallback((): InsightCard | null => {
    if (highlightIndex >= 0 && highlightIndex < results.length) {
      return results[highlightIndex];
    }
    return null;
  }, [highlightIndex, results]);

  return {
    searchTerm,
    setSearchTerm: setSearchTermAndReset,
    sourceFilter,
    setSourceFilter,
    highlightIndex,
    setHighlightIndex,
    moveHighlight,
    getHighlightedCard,
    results,
    total: query.data?.total ?? 0,
    filteredCount: results.length,
    isLoading: query.isFetching && isSearchActive,
    isSearchActive,
    clearSearch,
  };
}
