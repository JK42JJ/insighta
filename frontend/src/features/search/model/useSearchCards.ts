import { useQuery } from '@tanstack/react-query';
import { useState, useMemo } from 'react';
import { getAuthHeaders, getEdgeFunctionUrl } from '@/shared/lib/supabase-auth';
import { useAuth } from '@/features/auth/model/useAuth';
import type { LocalCard } from '@/entities/card/model/local-cards';
import { localCardToInsightCard } from '@/entities/card/model/local-cards';
import { useDebounce } from '@/shared/lib/useDebounce';

interface SearchResponse {
  cards: LocalCard[];
  total: number;
}

const SEARCH_DEBOUNCE_MS = 300;
const SEARCH_LIMIT = 30;

export const searchKeys = {
  all: ['search'] as const,
  query: (q: string) => [...searchKeys.all, q] as const,
};

export function useSearchCards() {
  const { isLoggedIn, isTokenReady } = useAuth();
  const [searchTerm, setSearchTerm] = useState('');
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

  const results = useMemo(
    () => query.data?.cards.map(localCardToInsightCard) ?? [],
    [query.data?.cards]
  );

  return {
    searchTerm,
    setSearchTerm,
    results,
    total: query.data?.total ?? 0,
    isLoading: query.isFetching && isSearchActive,
    isSearchActive,
    clearSearch: () => setSearchTerm(''),
  };
}
