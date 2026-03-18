// ============================================================================
// GraphView — Main Knowledge Graph View Component
// Integrates GraphCanvas with filter chips, loading/empty states, detail panel.
// ============================================================================

import { useRef, useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Network, Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { useGraphData } from './useGraphData';
import { useGraphViewStore } from './useGraphViewStore';
import { GraphCanvas } from './GraphCanvas';
import type { GraphNode, NodeCategory } from './types';

const CATEGORY_LABELS: Record<NodeCategory, string> = {
  structure: 'Structure',
  content: 'Content',
  derived: 'Derived',
};

export function GraphView() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useGraphData();
  const store = useGraphViewStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Resize observer for canvas dimensions
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // ESC to deselect
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') store.selectNode(null);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [store]);

  // Find selected node data for detail panel
  const selectedNode = useMemo(() => {
    if (!store.selectedNodeId || !data) return null;
    return data.nodes.find((n) => n.id === store.selectedNodeId) ?? null;
  }, [store.selectedNodeId, data]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <Loader2 className="w-5 h-5 animate-spin mr-2" />
        <span className="text-sm">{t('common.loading', 'Loading...')}</span>
      </div>
    );
  }

  // Error state
  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <span className="text-sm">{t('common.loadFailed', 'Failed to load. Tap to retry.')}</span>
      </div>
    );
  }

  // Empty state
  if (!data || data.nodes.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground gap-3">
        <Network className="w-10 h-10 opacity-30" />
        <p className="text-sm">{t('graph.empty', 'No knowledge nodes yet.')}</p>
        <p className="text-xs opacity-60">{t('graph.emptyHint', 'Save cards and create mandalas to build your knowledge graph.')}</p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Filter chips */}
      <div className="flex items-center gap-2 px-1 py-2">
        {(Object.entries(CATEGORY_LABELS) as [NodeCategory, string][]).map(([cat, label]) => {
          const active = store.categoryFilter.has(cat);
          const count = data.nodes.filter((n) => n.category === cat).length;
          return (
            <button
              key={cat}
              onClick={() => store.toggleCategory(cat)}
              className={cn(
                'px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                active
                  ? 'bg-primary/15 text-primary'
                  : 'bg-muted/50 text-muted-foreground hover:bg-muted'
              )}
            >
              {label} ({count})
            </button>
          );
        })}
        <span className="text-xs text-muted-foreground ml-auto">
          {data.nodes.length} nodes, {data.links.length} edges
        </span>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="flex-1 min-h-0 relative">
        {dimensions.width > 0 && (
          <GraphCanvas
            data={data}
            selectedNodeId={store.selectedNodeId}
            hoveredNodeId={store.hoveredNodeId}
            categoryFilter={store.categoryFilter}
            onNodeClick={store.selectNode}
            onNodeHover={store.hoverNode}
            width={dimensions.width}
            height={dimensions.height}
          />
        )}

        {/* Detail panel overlay */}
        {selectedNode && (
          <NodeDetailOverlay node={selectedNode} onClose={() => store.selectNode(null)} />
        )}
      </div>
    </div>
  );
}

// -- Inline detail overlay --

function NodeDetailOverlay({ node, onClose }: { node: GraphNode; onClose: () => void }) {
  return (
    <div className="absolute bottom-4 left-4 right-4 bg-surface-base/95 backdrop-blur-sm border rounded-lg shadow-lg p-4 animate-fade-in max-w-md">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">{node.label}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wider">
              {node.type}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {node.category}
            </span>
          </div>
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-xs shrink-0"
        >
          ESC
        </button>
      </div>
    </div>
  );
}
