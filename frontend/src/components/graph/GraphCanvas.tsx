// ============================================================================
// GraphCanvas — Sigma.js v3, 1:1 transplant of the sigma.js official demo
// rendering pipeline (docs/design/graph-sigma-parity-2026-07-27.md).
//
// Every visual number comes from the original demo source
// (packages/demo/src — measured 2026-07-27), NOT invented:
//  - node size:  (score-min)/(max-min)*(30-3)+3, score = degree     [S2]
//  - edges:      size 1, default color #ccc, arrow type             [S4]
//  - labels:     threshold 15 / density 0.07 / grid 60, plate       [S5]
//  - hover:      non-neighbors {#bbb, label:'', z0}, neighbor edges
//                {hover-node color, size 4}, others hidden, 40ms    [S6]
//  - hover card: white round-rect + shadow (canvas-utils)           [S7]
//  - fly-to:     getNodeDisplayData + ratio 0.05 / 600ms            [S8]
//  - filters:    written to the graph `hidden` attribute            [S9]
//  - palette:    the demo dataset's own cluster hexes               [S10]
//
// Deliberate divergences (design §2 — closed list):
//  - reducers installed once over a state ref (original reinstalls per hover;
//    reinstalling was this codebase's crash/flicker root — keep the fix),
//  - click opens the detail panel (product value) instead of a URL,
//  - selection = sticky hover with the same fade grammar,
//  - dark mode = mechanical translation table (§5); light is the parity look,
//  - layout computed client-side (original ships offline coordinates):
//    seeded init → FA2 inferSettings + outboundAttractionDistribution →
//    gentle noverlap. Louvain gives communities/colors.
// ============================================================================

import { useEffect, useMemo, useRef } from 'react';
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';
import louvain from 'graphology-communities-louvain';
import { SigmaContainer, useRegisterEvents, useSetSettings, useSigma } from '@react-sigma/core';
import { createNodeImageProgram } from '@sigma/node-image';
import '@react-sigma/core/lib/style.css';
// Reference-demo label font (S12). Latin/digit glyphs only — Hangul falls back to the
// system sans, same as the original would with Korean data.
import '@fontsource/lato/400.css';
import '@fontsource/lato/700.css';
import type { Settings } from 'sigma/settings';
import type { GraphData, NodeCategory, OntologyNodeType } from './types';
import {
  CANVAS_THEME_DARK,
  CANVAS_THEME_LIGHT,
  makeDrawHover,
  makeDrawLabel,
} from './canvas-utils';
import { TYPE_IMAGE } from './graph-icons';

interface GraphCanvasProps {
  data: GraphData;
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  categoryFilter: Set<NodeCategory>;
  mandalaNodeIds: Set<string>;
  onNodeClick: (id: string | null) => void;
  onNodeHover: (id: string | null) => void;
  /** Search fly-to: bump `n` with a node id to animate the camera to it. */
  focusRequest?: { id: string; n: number } | null;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Original demo constants (S6, S10, §5 dark translation).
// ---------------------------------------------------------------------------
const NODE_FADE = { light: '#bbb', dark: '#3a3e48' } as const;
const EDGE_FADE = { light: '#eee', dark: '#20242e' } as const;
const EDGE_DEFAULT = { light: '#ccc', dark: '#2e3340' } as const;

/** The reference demo dataset's own cluster palette (all unique hexes, extracted
 *  2026-07-27). Cycled for community counts beyond the list — the original
 *  reuses hues across clusters too; grey is reserved for the long tail. */
const CLUSTER_PALETTE: readonly string[] = [
  '#5f83cc', // blue
  '#57a835', // green
  '#db4139', // red
  '#d043c4', // magenta
  '#379982', // teal
  '#a4923a', // olive
  '#7145cd', // violet
  '#c94c83', // pink
  '#6c3e81', // plum
  '#b174cb', // lilac
  '#7c5d28', // brown
  '#477028', // forest
  '#a54a49', // brick
  '#579f5f', // sage
];
const PALETTE_CYCLE_LIMIT = CLUSTER_PALETTE.length * 2;
const MINOR_CLUSTER_COLOR = '#666666'; // original: small clusters share grey

const MIN_NODE_SIZE = 3; // original Root.tsx:73
const MAX_NODE_SIZE = 30; // original Root.tsx:74
// Below this RENDERED size (screen px at current zoom) the stroke pictograms
// turn to ring noise — reducer swaps them for clean solid dots.
const ICON_MIN_RENDERED_SIZE = 9;
const HOVER_DEBOUNCE_MS = 40; // original GraphSettingsController.tsx:18
// Original uses 4 (GraphSettingsController.tsx:43) — too thick against our
// smaller satellites at deep zoom; thinned per James 2026-07-27 (§2 list).
const HIGHLIGHT_EDGE_SIZE = 2;

const TYPE_TAG: Record<OntologyNodeType, string> = {
  mandala: 'Mandala',
  mandala_sector: 'Sector',
  goal: 'Goal',
  topic: 'Topic',
  resource: 'Resource',
  note: 'Note',
  source: 'Source',
  source_segment: 'Segment',
  insight: 'Insight',
  video_resource: 'Video',
  concept: 'Concept',
  atom_node: 'Atom',
  section_node: 'Section',
  action_node: 'Action',
};

function isDarkMode(): boolean {
  return document.documentElement.classList.contains('dark');
}

/** Deterministic pseudo-random in [-1, 1] from a string (layout seed). */
function seededCoord(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  }
  return ((h >>> 0) % 20000) / 10000 - 1;
}

// ---------------------------------------------------------------------------
// Build + layout: seed → FA2 (inferSettings, design §4) → noverlap → louvain
// communities → original size formula + palette. Runs once per data change.
// ---------------------------------------------------------------------------
function buildLayoutedGraph(data: GraphData): Graph {
  const t0 = performance.now();
  const graph = new Graph({ multi: true, type: 'directed' });

  const typeById = new Map(data.nodes.map((n) => [n.id, n.type]));
  data.nodes.forEach((node) => {
    graph.addNode(node.id, {
      label: node.label,
      category: node.category,
      tag: TYPE_TAG[node.type] ?? 'unknown',
      x: seededCoord(node.id, 0x9e3779b9),
      y: seededCoord(node.id, 0x85ebca6b),
    });
  });

  data.links.forEach((link) => {
    // Self-loops: sigma's programs cannot render them — skip defensively.
    if (link.source === link.target) return;
    if (graph.hasNode(link.source) && graph.hasNode(link.target)) {
      // Original: every edge gets size 1 and no color (renderer default).
      graph.addEdge(link.source, link.target, { size: 1 });
    }
  });

  // S2 — original size band [3, 30]. The original feeds a power-law score
  // (pagerank-like: a handful of big hubs, everything else tiny) through a
  // linear map; our degree distribution is flat-topped (hundreds of
  // mid-degree videos), so a direct linear map floods the label band.
  // Percentile^8 mapping reproduces the original's RESULT — same [3,30]
  // band, hubs-only top end (design §2 divergence list).
  const degrees = [...new Set(graph.mapNodes((node) => graph.degree(node)))].sort((a, b) => a - b);
  const pctByDegree = new Map(
    degrees.map((d, i) => [d, degrees.length > 1 ? i / (degrees.length - 1) : 1])
  );
  graph.forEachNode((node) => {
    const pct = pctByDegree.get(graph.degree(node)) ?? 0;
    // pct^6: power-law top end like the original, but with a real mid-size
    // band (pct^8 was bimodal — giant hubs + dust, side-by-side 2026-07-27).
    const size = MIN_NODE_SIZE + (MAX_NODE_SIZE - MIN_NODE_SIZE) * pct ** 6;
    graph.setNodeAttribute(node, 'size', size);
    // S11 — every node carries its pictogram (like the original); the
    // nodeReducer hides it below ICON_MIN_RENDERED_SIZE at the CURRENT zoom,
    // so overview shows clean dots and zooming reveals icons (map behavior).
    const image = TYPE_IMAGE[typeById.get(node) ?? ('' as OntologyNodeType)];
    if (image) graph.setNodeAttribute(node, 'image', image);
  });

  // Louvain BEFORE layout: communities drive both the palette and the
  // initial seeding (below).
  const communityRank = new Map<number, number>();
  if (graph.order > 0 && graph.size > 0) {
    louvain.assign(graph, { nodeCommunityAttribute: 'community' });
    const counts = new Map<number, number>();
    const hub = new Map<number, { node: string; degree: number }>();
    graph.forEachNode((node) => {
      const c = graph.getNodeAttribute(node, 'community') as number;
      counts.set(c, (counts.get(c) ?? 0) + 1);
      // Community label prefers STRUCTURE hubs (sector/goal/mandala) — a
      // high-degree concept as "cluster name" reads as noise in the hover
      // card. Structure nodes get a large tie-break bonus.
      const structural = graph.getNodeAttribute(node, 'category') === 'structure';
      const d = graph.degree(node) + (structural ? 1000 : 0);
      if ((hub.get(c)?.degree ?? -1) < d) hub.set(c, { node, degree: d });
    });
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
    ranked.forEach((c, i) => communityRank.set(c, i));
    const colorByCommunity = new Map(
      ranked.map((c, i) => [
        c,
        i < PALETTE_CYCLE_LIMIT ? CLUSTER_PALETTE[i % CLUSTER_PALETTE.length] : MINOR_CLUSTER_COLOR,
      ])
    );
    graph.forEachNode((node) => {
      const c = graph.getNodeAttribute(node, 'community') as number;
      graph.setNodeAttribute(node, 'color', colorByCommunity.get(c) ?? MINOR_CLUSTER_COLOR);
      const h = hub.get(c);
      graph.setNodeAttribute(
        node,
        'clusterLabel',
        h ? (graph.getNodeAttribute(h.node, 'label') as string) : ''
      );
    });

    // Community-aware seeding: each community starts at its own angle on a
    // ring, satellites jittered around it. Random seeds + LinLog's gentle
    // attraction never localized communities within our iteration budget
    // (v17-v19: salt-and-pepper) — Gephi solves this with 10k+ iterations,
    // we solve it with a structured start. Deterministic (community rank +
    // id hash).
    // Angle jitter + per-community radius variation break the mechanical
    // "fan spokes" of an even ring (v20) into an organic scatter.
    const communityCount = Math.max(1, communityRank.size);
    graph.forEachNode((node) => {
      const c = graph.getNodeAttribute(node, 'community') as number;
      const rank = communityRank.get(c) ?? 0;
      const cKey = `c${c}`;
      const angle = (2 * Math.PI * rank) / communityCount + seededCoord(cKey, 0x27d4eb2f) * 0.6;
      const radius = 0.75 + (seededCoord(cKey, 0x165667b1) + 1) * 0.3; // 0.75..1.35
      graph.setNodeAttribute(
        node,
        'x',
        Math.cos(angle) * radius + seededCoord(node, 0x9e3779b9) * 0.35
      );
      graph.setNodeAttribute(
        node,
        'y',
        Math.sin(angle) * radius + seededCoord(node, 0x85ebca6b) * 0.35
      );
    });
  }

  // §4 — layout. LinLog carpet over the community-seeded start.
  if (graph.order > 1) {
    const tFa2 = performance.now();
    forceAtlas2.assign(graph, {
      iterations: 500,
      settings: {
        ...forceAtlas2.inferSettings(graph),
        // Always-on Barnes-Hut: measured 12.4s for 1.4k nodes without it
        // (inferSettings only enables it above 2000); with it the same
        // graph lays out in ~O(N log N). Required for the 4k prod cap.
        barnesHutOptimize: true,
        // LinLog — the reference cartography grammar (Gephi/médialab workflow):
        // logarithmic attraction spreads satellites into an even carpet
        // instead of standard mode's tight hub rings (design review, James
        // 2026-07-27). outboundAttractionDistribution stays OFF — it weakens
        // hub pull under LinLog until communities dissolve (v17/v18).
        linLogMode: true,
        scalingRatio: 10,
        gravity: 0.05,
      },
    });
    const tNov = performance.now();
    // Satellites must never sit ON a hub disc (side-by-side 2026-07-27) —
    // margin/iterations sized for the 30px hubs; measured cost is ~10ms.
    noverlap.assign(graph, {
      maxIterations: 200,
      settings: { margin: 3, ratio: 1.1 },
    });
    // eslint-disable-next-line no-console
    console.info(
      `[graph] fa2 ${Math.round(tNov - tFa2)}ms noverlap ${Math.round(performance.now() - tNov)}ms`
    );
  }

  if (!(graph.order > 0 && graph.size > 0)) {
    graph.forEachNode((node) => {
      graph.setNodeAttribute(node, 'color', CLUSTER_PALETTE[0]);
      graph.setNodeAttribute(node, 'clusterLabel', '');
    });
  }

  // Layout perf evidence (design §7-3).
  // eslint-disable-next-line no-console
  console.info(
    `[graph] layout ${graph.order}n/${graph.size}e in ${Math.round(performance.now() - t0)}ms`
  );
  return graph;
}

/** Mutable interaction state read by the (installed-once) reducers. */
interface InteractionState {
  dark: boolean;
  selectedId: string | null;
  targetId: string | null;
  targetColor: string;
  connected: Set<string>;
  mandalaNodeIds: Set<string>;
}

/** Headless controller: events + installed-once reducers over a state ref. */
function GraphController({
  selectedNodeId,
  hoveredNodeId,
  categoryFilter,
  mandalaNodeIds,
  onNodeClick,
  onNodeHover,
}: Omit<GraphCanvasProps, 'data' | 'width' | 'height' | 'focusRequest'>) {
  const sigma = useSigma();
  const registerEvents = useRegisterEvents();
  const setSettings = useSetSettings();

  const stateRef = useRef<InteractionState>({
    dark: isDarkMode(),
    selectedId: null,
    targetId: null,
    targetColor: '',
    connected: new Set(),
    mandalaNodeIds,
  });

  // Recompute the highlight neighborhood from hover ONLY — the original's
  // fade grammar is a transient hover effect; selection (our extension)
  // shows the sticky hover card + detail panel without fading the graph
  // (a standing fade + size-4 edges overwhelmed the deep search zoom).
  // Reassigned EVERY render so it always closes over the current sigma.
  const applyTargetRef = useRef<(hoverId: string | null) => void>(() => {});
  applyTargetRef.current = (hoverId: string | null) => {
    const s = stateRef.current;
    const target = hoverId;
    s.targetId = target;
    const connected = new Set<string>();
    const graph = sigma.getGraph();
    if (target && graph.hasNode(target)) {
      connected.add(target);
      graph.forEachNeighbor(target, (n) => connected.add(n));
      // Original: neighbor edges take the hovered node's display color.
      s.targetColor = sigma.getNodeDisplayData(target)?.color ?? '';
    }
    s.connected = connected;
  };

  // Hover: sigma-internal (ref + refresh), debounced 40ms like the original.
  const hoverRef = useRef<string | null>(null);
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    const applyHover = (node: string | null) => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
      debounceRef.current = window.setTimeout(() => {
        hoverRef.current = node;
        applyTargetRef.current(node);
        sigma.refresh();
        onNodeHover(node);
      }, HOVER_DEBOUNCE_MS);
    };
    registerEvents({
      clickNode: ({ node }) => onNodeClick(node === stateRef.current.selectedId ? null : node),
      clickStage: () => onNodeClick(null),
      enterNode: ({ node }) => {
        sigma.getContainer().style.cursor = 'pointer';
        applyHover(node);
      },
      leaveNode: () => {
        sigma.getContainer().style.cursor = '';
        applyHover(null);
      },
    });
    return () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    };
  }, [registerEvents, sigma, onNodeClick, onNodeHover]);

  // React-driven state (selection / mandala scope) → ref + refresh.
  useEffect(() => {
    const s = stateRef.current;
    s.selectedId = selectedNodeId;
    s.mandalaNodeIds = mandalaNodeIds;
    applyTargetRef.current(hoverRef.current ?? hoveredNodeId);
    sigma.refresh();
  }, [sigma, selectedNodeId, hoveredNodeId, mandalaNodeIds]);

  // S9 — category filter writes the `hidden` graph attribute (original
  // GraphDataController grammar), not a reducer branch.
  useEffect(() => {
    const graph = sigma.getGraph();
    graph.forEachNode((node) => {
      const category = graph.getNodeAttribute(node, 'category') as NodeCategory;
      graph.setNodeAttribute(node, 'hidden', !categoryFilter.has(category));
    });
  }, [sigma, categoryFilter]);

  // Theme watch (§5): swap canvas renderers + edge default, refresh.
  useEffect(() => {
    const applyTheme = (dark: boolean) => {
      const theme = dark ? CANVAS_THEME_DARK : CANVAS_THEME_LIGHT;
      setSettings({
        defaultDrawNodeLabel: makeDrawLabel(theme),
        defaultDrawNodeHover: makeDrawHover(theme),
        defaultEdgeColor: EDGE_DEFAULT[dark ? 'dark' : 'light'],
      });
      sigma.refresh();
    };
    const observer = new MutationObserver(() => {
      const dark = isDarkMode();
      if (dark !== stateRef.current.dark) {
        stateRef.current.dark = dark;
        applyTheme(dark);
      }
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, [sigma, setSettings]);

  // Reducers installed ONCE — original demo grammar (S6), reading stateRef.
  useEffect(() => {
    setSettings({
      nodeReducer: (node, attrs) => {
        const s = stateRef.current;
        const res: Record<string, unknown> = { ...attrs };
        const fade = NODE_FADE[s.dark ? 'dark' : 'light'];

        // Zoom-dependent pictogram gate (map behavior — see build comment).
        if (sigma.scaleSize(attrs.size as number) < ICON_MIN_RENDERED_SIZE) {
          res.image = null;
        }

        // Mandala scope: out-of-scope nodes wear the persistent fade
        // (label kept — scope is a standing state, not a transient hover).
        if (s.mandalaNodeIds.size > 0 && !s.mandalaNodeIds.has(node)) {
          res.color = fade;
          res.zIndex = 0;
        }

        // S6 hover/selection grammar, verbatim (faded nodes also drop their
        // pictogram — original sets image: null).
        if (s.targetId) {
          if (s.connected.has(node)) {
            res.zIndex = 1;
          } else {
            res.color = fade;
            res.label = '';
            res.zIndex = 0;
            res.image = null;
            res.highlighted = false;
          }
        }
        // Selection = sticky hover: the original's `highlighted` flag keeps
        // the hover card up (SearchField grammar).
        if (node === s.selectedId) {
          res.highlighted = true;
          res.zIndex = 2;
        }
        return res;
      },
      edgeReducer: (edge, attrs) => {
        const s = stateRef.current;
        const g = sigma.getGraph();
        const res: Record<string, unknown> = { ...attrs };

        if (s.mandalaNodeIds.size > 0) {
          const inScope =
            s.mandalaNodeIds.has(g.source(edge)) && s.mandalaNodeIds.has(g.target(edge));
          if (!inScope) res.color = EDGE_FADE[s.dark ? 'dark' : 'light'];
        }

        // S6, verbatim: neighbor edges take the target's color at size 4;
        // every other edge is hidden while a target is active.
        if (s.targetId) {
          if (g.hasExtremity(edge, s.targetId)) {
            res.color = s.targetColor;
            res.size = HIGHLIGHT_EDGE_SIZE;
            res.zIndex = 1;
          } else {
            res.hidden = true;
          }
        }
        return res;
      },
    });
  }, [sigma, setSettings]);

  return null;
}

/** Fly the camera to a node — original SearchField grammar (S8). */
function FocusCamera({ request }: { request?: { id: string; n: number } | null }) {
  const sigma = useSigma();
  useEffect(() => {
    if (!request) return;
    const graph = sigma.getGraph();
    if (!graph.hasNode(request.id)) return;
    const displayData = sigma.getNodeDisplayData(request.id);
    if (!displayData) return;
    sigma.getCamera().animate({ ...displayData, ratio: 0.05 }, { duration: 600 });
  }, [sigma, request]);
  return null;
}

/** Recenter the camera when the underlying data set changes. */
function CameraReset({ nodeCount }: { nodeCount: number }) {
  const sigma = useSigma();
  useEffect(() => {
    if (nodeCount > 0) {
      sigma.getCamera().animatedReset({ duration: 300 });
    }
  }, [sigma, nodeCount]);
  return null;
}

// S5/S12 — original demo settings, verbatim numbers. Canvas renderers are
// theme-aware (installed for the boot theme; GraphController swaps on change).
function buildSigmaSettings(dark: boolean): Partial<Settings> {
  const theme = dark ? CANVAS_THEME_DARK : CANVAS_THEME_LIGHT;
  return {
    // S11 — the original's node program, identical options (Root.tsx:34-38).
    nodeProgramClasses: {
      image: createNodeImageProgram({
        size: { mode: 'force', value: 256 },
      }),
    },
    defaultNodeType: 'image',
    defaultDrawNodeLabel: makeDrawLabel(theme),
    defaultDrawNodeHover: makeDrawHover(theme),
    defaultEdgeType: 'arrow',
    defaultEdgeColor: EDGE_DEFAULT[dark ? 'dark' : 'light'],
    labelDensity: 0.07,
    labelGridCellSize: 60,
    labelRenderedSizeThreshold: 15,
    labelFont: 'Lato, sans-serif',
    zIndex: true,
    minCameraRatio: 0.03,
    maxCameraRatio: 20,
    enableEdgeEvents: false,
    allowInvalidContainer: true,
  };
}

/** WebGL availability — computed once; graceful fallback if absent. */
let webglSupport: boolean | null = null;
function hasWebGL(): boolean {
  if (webglSupport === null) {
    try {
      const canvas = document.createElement('canvas');
      webglSupport = Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
    } catch {
      webglSupport = false;
    }
  }
  return webglSupport;
}

export function GraphCanvas({
  data,
  selectedNodeId,
  hoveredNodeId,
  categoryFilter,
  mandalaNodeIds,
  onNodeClick,
  onNodeHover,
  focusRequest,
  width,
  height,
}: GraphCanvasProps) {
  // Layout once per data set — referential stability is the anti-flicker
  // contract (data is memoized upstream in useGraphData).
  const graph = useMemo(() => buildLayoutedGraph(data), [data]);
  const settings = useMemo(() => buildSigmaSettings(isDarkMode()), []);

  if (!hasWebGL()) {
    return (
      <div
        style={{ width, height }}
        className="flex items-center justify-center text-sm text-muted-foreground"
      >
        WebGL is required to display the knowledge graph.
      </div>
    );
  }

  return (
    <SigmaContainer
      graph={graph}
      settings={settings}
      style={{
        width,
        height,
        // S3 — original: white canvas. Dark = §5 translation.
        background: isDarkMode() ? '#111318' : '#ffffff',
      }}
    >
      <GraphController
        selectedNodeId={selectedNodeId}
        hoveredNodeId={hoveredNodeId}
        categoryFilter={categoryFilter}
        mandalaNodeIds={mandalaNodeIds}
        onNodeClick={onNodeClick}
        onNodeHover={onNodeHover}
      />
      <CameraReset nodeCount={graph.order} />
      <FocusCamera request={focusRequest} />
    </SigmaContainer>
  );
}
