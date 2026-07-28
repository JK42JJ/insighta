// ============================================================================
// GraphView — Main Knowledge Graph View Component
// Integrates GraphCanvas with filter chips, loading/empty states, detail panel.
// ============================================================================

import { useRef, useState, useEffect, useMemo, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Network, Loader2, Search, Play } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { handleThumbnailError, handleThumbnailLoad } from '@/shared/lib/image-utils';
import { useGraphData } from './useGraphData';
import { useGraphViewStore } from './useGraphViewStore';
import type { GraphNode, NodeCategory } from './types';

// Lazy: sigma references WebGL globals at module scope, so it must never load
// in non-browser environments (jsdom tests import CardListView → GraphView).
// Bonus: the sigma/graphology stack becomes an on-demand chunk instead of
// shipping in the main bundle.
const GraphCanvas = lazy(() => import('./GraphCanvas').then((m) => ({ default: m.GraphCanvas })));

const CATEGORY_LABELS: Record<NodeCategory, string> = {
  structure: 'Structure',
  content: 'Content',
  derived: 'Derived',
};

interface GraphViewProps {
  mandalaId?: string | null;
  /** In-app video open (wired by CardListView → video panel/modal). Receives
   *  the raw locator: youtube id from source_ref when known, else the node's
   *  url — the caller normalizes/matches against its card list. */
  onOpenVideo?: (target: { youtubeId: string | null; url: string | null }) => void;
}

export function GraphView({ mandalaId, onOpenVideo }: GraphViewProps) {
  const { t } = useTranslation();
  const { data, mandalaNodeIds, isLoading, isError } = useGraphData(mandalaId);
  const store = useGraphViewStore();
  // Callback-ref measurement: the old `useRef + useEffect([], …)` pattern ran
  // once while the LOADING branch was rendered (ref unattached, early return)
  // and never re-ran — first-ever open stayed blank until a remount with a
  // warm query cache. State-ref re-fires the observer effect whenever the
  // container div actually mounts.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [focusRequest, setFocusRequest] = useState<{
    id: string;
    n: number;
    ratio?: number;
  } | null>(null);

  // Entering from a mandala: the user-wide universe renders in full color and
  // the camera lands on that mandala's neighborhood (fading everything else
  // grey was the beta-day dull-mass bug). One flight per mandala change.
  const focusedMandalaRef = useRef<string | null>(null);
  useEffect(() => {
    if (!mandalaId || !data || dimensions.width === 0) return;
    if (focusedMandalaRef.current === mandalaId) return;
    const root = data.nodes.find(
      (n) => n.sourceRef?.table === 'user_mandalas' && n.sourceRef.id === mandalaId
    );
    if (!root) return;
    focusedMandalaRef.current = mandalaId;
    // After CameraReset's 300ms animatedReset, or the flight gets overridden.
    const timer = window.setTimeout(() => {
      setFocusRequest((prev) => ({ id: root.id, n: (prev?.n ?? 0) + 1, ratio: 0.35 }));
    }, 450);
    return () => window.clearTimeout(timer);
  }, [mandalaId, data, dimensions.width]);

  // Resize observer for canvas dimensions — rAF delays until flex layout completes
  useEffect(() => {
    if (!containerEl) return;

    // rAF ensures measurement happens after layout is complete (Bug #7 fix)
    const raf = requestAnimationFrame(() => {
      const rect = containerEl.getBoundingClientRect();
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
    observer.observe(containerEl);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [containerEl]);

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
        <p className="text-xs opacity-60">
          {t('graph.emptyHint', 'Save cards and create mandalas to build your knowledge graph.')}
        </p>
      </div>
    );
  }

  return (
    <div ref={setContainerEl} className="absolute inset-0">
      {/* Canvas fills entire area */}
      {dimensions.width > 0 && dimensions.height > 0 && (
        <Suspense
          fallback={
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          }
        >
          <GraphCanvas
            data={data}
            selectedNodeId={store.selectedNodeId}
            hoveredNodeId={store.hoveredNodeId}
            categoryFilter={store.categoryFilter}
            mandalaNodeIds={mandalaNodeIds}
            onNodeClick={store.selectNode}
            onNodeHover={store.hoverNode}
            focusRequest={focusRequest}
            width={dimensions.width}
            height={dimensions.height}
          />
        </Suspense>
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

      {/* Search overlay — the finder: type → pick → camera flies to the node */}
      <GraphSearch
        nodes={data.nodes}
        onPick={(id) => {
          store.selectNode(id);
          setFocusRequest((prev) => ({ id, n: (prev?.n ?? 0) + 1 }));
        }}
      />

      {/* Detail panel overlay */}
      {selectedNode && (
        <NodeDetailOverlay
          node={selectedNode}
          linkCount={
            data.links.filter((l) => l.source === selectedNode.id || l.target === selectedNode.id)
              .length
          }
          onClose={() => store.selectNode(null)}
          onOpenVideo={onOpenVideo}
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
  onOpenVideo,
}: {
  node: GraphNode;
  linkCount: number;
  onClose: () => void;
  onOpenVideo?: (target: { youtubeId: string | null; url: string | null }) => void;
}) {
  const { t } = useTranslation();
  const url = typeof node.properties.url === 'string' ? node.properties.url : null;
  // video_resource nodes carry the YouTube id in source_ref (prod-verified);
  // legacy resource nodes carry a url + thumbnail in properties.
  const youtubeId =
    node.sourceRef?.table === 'youtube_videos' && node.sourceRef.id ? node.sourceRef.id : null;
  const isVideoNode = youtubeId !== null || (node.type === 'resource' && url !== null);
  const thumbnail =
    typeof node.properties.thumbnail === 'string'
      ? node.properties.thumbnail
      : youtubeId
        ? `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`
        : null;

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
            <span className="text-[10px] text-muted-foreground">{node.category}</span>
            <span className="text-[10px] text-muted-foreground">
              {linkCount} {t('graph.connections', 'connections')}
            </span>
          </div>

          {/* Primary action — jump from knowledge to the actual video */}
          {isVideoNode && onOpenVideo && (
            <button
              onClick={() => onOpenVideo({ youtubeId, url })}
              className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
            >
              <Play className="w-3 h-3" />
              {t('graph.openVideo', 'Open video')}
            </button>
          )}

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
              loading="lazy"
              decoding="async"
              onError={handleThumbnailError}
              onLoad={handleThumbnailLoad}
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

// -- Search overlay (the finder) --

function GraphSearch({ nodes, onPick }: { nodes: GraphNode[]; onPick: (id: string) => void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 1) return [];
    return nodes.filter((n) => n.fullTitle.toLowerCase().includes(q)).slice(0, 8);
  }, [nodes, query]);

  return (
    <div className="absolute top-12 right-2 w-64 pointer-events-auto">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder={t('graph.searchPlaceholder', 'Find in my knowledge…')}
          className="w-full pl-8 pr-3 py-1.5 rounded-md bg-surface-base/90 backdrop-blur-sm border text-xs focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
      {open && results.length > 0 && (
        <ul className="mt-1 rounded-md border bg-surface-base/95 backdrop-blur-sm shadow-lg overflow-hidden">
          {results.map((n) => (
            <li key={n.id}>
              <button
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onPick(n.id);
                  setOpen(false);
                  setQuery('');
                }}
                className="w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors"
              >
                <span className="block text-xs truncate">{n.fullTitle}</span>
                <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  {n.type}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim().length > 0 && results.length === 0 && (
        <div className="mt-1 rounded-md border bg-surface-base/95 backdrop-blur-sm px-3 py-2 text-xs text-muted-foreground">
          {t('graph.noResults', 'No matches')}
        </div>
      )}
    </div>
  );
}
