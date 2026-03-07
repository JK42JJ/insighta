import { useState, useCallback, useEffect, useMemo } from 'react';
import { InsightCard } from '@/types/mandala';

export function useListSelection(filteredCards: InsightCard[]) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedCard = useMemo(
    () => filteredCards.find((c) => c.id === selectedId) ?? null,
    [filteredCards, selectedId]
  );

  // Clear selection if selected card is no longer in filtered list
  useEffect(() => {
    if (selectedId && !filteredCards.some((c) => c.id === selectedId)) {
      setSelectedId(null);
    }
  }, [filteredCards, selectedId]);

  const select = useCallback((card: InsightCard) => {
    setSelectedId(card.id);
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedId(null);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (filteredCards.length === 0) return;
      // Don't intercept if user is typing in an input/textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      if (e.key === 'Escape') {
        clearSelection();
        return;
      }

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const currentIndex = selectedId ? filteredCards.findIndex((c) => c.id === selectedId) : -1;

        let nextIndex: number;
        if (e.key === 'ArrowDown') {
          nextIndex = currentIndex < filteredCards.length - 1 ? currentIndex + 1 : 0;
        } else {
          nextIndex = currentIndex > 0 ? currentIndex - 1 : filteredCards.length - 1;
        }

        setSelectedId(filteredCards[nextIndex].id);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredCards, selectedId, clearSelection]);

  return {
    selectedId,
    selectedCard,
    select,
    clearSelection,
  };
}
