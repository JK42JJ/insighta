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

interface GraphViewProps {
  mandalaId?: string | null;
}

export function GraphView({ mandalaId }: GraphViewProps) {
  const { t } = useTranslation();
  const { data, mandalaNodeIds, isLoading, isError } = useGraphData(mandalaId);
  const store = useGraphViewStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });

  // Resize observer for canvas dimensions — rAF delays until flex layout completes
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // rAF ensures measurement happens after layout is complete (Bug #7 fix)
    const raf = requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setDimensions({ width: rect.width, height: rect.height });
      }
    });

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
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
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
    <div ref={containerRef} className="absolute inset-0">
      {/* Canvas fills entire area */}
      {dimensions.width > 0 && dimensions.height > 0 && (
        <GraphCanvas
          data={data}
          selectedNodeId={store.selectedNodeId}
          hoveredNodeId={store.hoveredNodeId}
          categoryFilter={store.categoryFilter}
          mandalaNodeIds={mandalaNodeIds}
          onNodeClick={store.selectNode}
          onNodeHover={store.hoverNode}
          width={dimensions.width}
          height={dimensions.height}
        />
      )}

      {/* Filter chips overlay */}
      <div className="absolute top-2 left-2 right-2 flex items-center gap-2 pointer-events-none">
        {(Object.entries(CATEGORY_LABELS) as [NodeCategory, string][]).map(([cat, label]) => {
          const active = store.categoryFilter.has(cat);
          const count = data.nodes.filter((n) => n.category === cat).length;
          return (
            <button
              key={cat}
              onClick={() => store.toggleCategory(cat)}
              className={cn(
                'px-2.5 py-1 rounded-full text-xs font-medium transition-colors pointer-events-auto backdrop-blur-sm',
                active
                  ? 'bg-primary/15 text-primary'
                  : 'bg-muted/60 text-muted-foreground hover:bg-muted'
              )}
            >
              {label} ({count})
            </button>
          );
        })}
        <span className="text-xs text-muted-foreground ml-auto bg-surface-base/70 backdrop-blur-sm px-2 py-1 rounded-full pointer-events-auto">
          {data.nodes.length} nodes, {data.links.length} edges
        </span>
      </div>

      {/* Detail panel overlay */}
      {selectedNode && (
        <NodeDetailOverlay
          node={selectedNode}
          linkCount={data.links.filter(
            (l) => l.source === selectedNode.id || l.target === selectedNode.id
          ).length}
          onClose={() => store.selectNode(null)}
        />
      )}
    </div>
  );
}

// -- Inline detail overlay --

function NodeDetailOverlay({
  node,
  linkCount,
  onClose,
}: {
  node: GraphNode;
  linkCount: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const url = typeof node.properties.url === 'string' ? node.properties.url : null;
  const thumbnail = typeof node.properties.thumbnail === 'string' ? node.properties.thumbnail : null;

  return (
    <div className="absolute bottom-4 left-4 right-4 bg-surface-base/95 backdrop-blur-sm border rounded-lg shadow-lg p-4 animate-fade-in max-w-md">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {/* Full title — no truncation */}
          <p className="text-sm font-medium break-words">{node.fullTitle}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wider">
              {node.type}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {node.category}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {linkCount} {t('graph.connections', 'connections')}
            </span>
          </div>

          {/* Type-specific details */}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline mt-2 block truncate"
            >
              {url}
            </a>
          )}
          {thumbnail && (
            <img
              src={thumbnail}
              alt=""
              className="mt-2 rounded h-16 object-cover"
            />
          )}
          {node.type === 'goal' && node.properties.level_key && (
            <p className="text-xs text-muted-foreground mt-1">
              Level: {String(node.properties.level_key)}
            </p>
          )}
          {node.type === 'mandala_sector' && node.properties.center_goal && (
            <p className="text-xs text-muted-foreground mt-1">
              Goal: {String(node.properties.center_goal)}
            </p>
          )}
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
