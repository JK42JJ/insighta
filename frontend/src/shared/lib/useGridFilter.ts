import { useMemo, useState, useDeferredValue } from 'react';
import { InsightCard, LinkType } from '@/types/mandala';

export type SortOption = 'latest' | 'name' | 'type';
export type SourceFilter = 'all' | 'youtube' | 'local' | 'url';

export function useGridFilter(cards: InsightCard[]) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('latest');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  const deferredQuery = useDeferredValue(searchQuery);

  const filteredCards = useMemo(() => {
    let result = cards;

    // Source filter
    if (sourceFilter !== 'all') {
      result = result.filter((card) => {
        const type = card.linkType;
        switch (sourceFilter) {
          case 'youtube':
            return type === 'youtube' || type === 'youtube-shorts';
          case 'local':
            return type === 'txt' || type === 'md' || type === 'pdf';
          case 'url':
            return (
              type !== 'youtube' &&
              type !== 'youtube-shorts' &&
              type !== 'txt' &&
              type !== 'md' &&
              type !== 'pdf'
            );
          default:
            return true;
        }
      });
    }

    // Search filter
    if (deferredQuery.trim()) {
      const q = deferredQuery.toLowerCase();
      result = result.filter(
        (card) =>
          card.title.toLowerCase().includes(q) ||
          card.userNote?.toLowerCase().includes(q) ||
          card.videoUrl?.toLowerCase().includes(q)
      );
    }

    // Sort
    result = [...result].sort((a, b) => {
      switch (sortBy) {
        case 'latest':
          return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
        case 'name':
          return a.title.localeCompare(b.title);
        case 'type':
          return (a.linkType ?? '').localeCompare(b.linkType ?? '');
        default:
          return 0;
      }
    });

    return result;
  }, [cards, deferredQuery, sortBy, sourceFilter]);

  return {
    searchQuery,
    setSearchQuery,
    sortBy,
    setSortBy,
    sourceFilter,
    setSourceFilter,
    filteredCards,
  };
}
