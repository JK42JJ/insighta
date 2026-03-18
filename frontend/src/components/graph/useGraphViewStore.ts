// ============================================================================
// Graph View Store (React useState-based)
// Local UI state for the Knowledge Graph view.
// ============================================================================

import { useState, useCallback, useMemo } from 'react';
import type { NodeCategory } from './types';

const ALL_CATEGORIES: NodeCategory[] = ['structure', 'content', 'derived'];

export function useGraphViewStore() {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<Set<NodeCategory>>(
    () => new Set(ALL_CATEGORIES)
  );

  const selectNode = useCallback((id: string | null) => setSelectedNodeId(id), []);
  const hoverNode = useCallback(
    (id: string | null) => setHoveredNodeId((prev) => (prev === id ? prev : id)),
    []
  );

  const toggleCategory = useCallback((category: NodeCategory) => {
    setCategoryFilter((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        if (next.size > 1) next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  const resetFilters = useCallback(() => {
    setSelectedNodeId(null);
    setHoveredNodeId(null);
    setCategoryFilter(new Set(ALL_CATEGORIES));
  }, []);

  return useMemo(
    () => ({
      selectedNodeId,
      hoveredNodeId,
      categoryFilter,
      selectNode,
      hoverNode,
      toggleCategory,
      resetFilters,
    }),
    [selectedNodeId, hoveredNodeId, categoryFilter, selectNode, hoverNode, toggleCategory, resetFilters]
  );
}
