# MA-2: Knowledge Graph View — Feature Specification

> Milestone: MA-2 (Service Ontology)
> Epic: #105 GraphRAG — Agent-Human Collaboration Intelligence
> Domain: `service` only — system nodes are excluded from this view.

---

## 1. Overview

### Problem

Users accumulate knowledge across mandalas (cards, videos, notes) but have no way to see how these knowledge fragments **connect**. The mandala grid shows structure; the list/grid views show individual items. Neither reveals the relationships between them.

### Solution

A **Knowledge Graph View** integrated as the 4th view in the existing ViewSwitcher. Users see their knowledge as an interactive node-link diagram, with mandala structure as the organizing backbone.

### Scope

- Read-only graph visualization of `domain='service'` ontology nodes and edges
- Integrated into existing view-switching pattern (not a separate page)
- Reuses existing UI patterns: sidebar, filter chips, ResizablePanel, empty states
- Mandala-centric layout as the differentiating feature

### Out of Scope (MA-3+)

- Node/edge creation or editing from the graph view
- AI-powered suggestions (insight generation, topic clustering)
- Temporal workflow integration
- System domain visualization

---

## 2. Data Source

### Ontology API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /api/ontology/nodes?domain=service` | Fetch all service nodes for the graph |
| `GET /api/ontology/nodes/:id/neighbors` | Expand neighbors on double-click |
| `GET /api/ontology/stats` | Node/edge counts for graph metadata |

### Node Types Rendered (Service Domain, 9 types)

| Type | Source | Expected Volume |
|------|--------|----------------|
| `mandala` | `user_mandalas` (shadow trigger) | ~5-10 per user |
| `mandala_sector` | `user_mandala_levels` (shadow trigger) | ~40-80 per user |
| `resource` | `user_local_cards` (shadow trigger) | ~50-200 per user |
| `source` | `youtube_videos` (shadow trigger) | ~20-100 per user |
| `goal` | Manual creation (MA-1) | ~5-20 per user |
| `topic` | AI extraction (MA-3) | 0 (future) |
| `note` | Manual creation (MA-1) | ~10-50 per user |
| `source_segment` | AI extraction (MA-3) | 0 (future) |
| `insight` | AI generation (MA-3) | 0 (future) |

### Edge Types Rendered (Service Domain, 5 types)

| Relation | Visual | Meaning |
|----------|--------|---------|
| `CONTAINS` | Solid line, opacity 0.4 | mandala → mandala_sector |
| `PLACED_IN` | Solid line, opacity 0.4 | resource → mandala_sector |
| `DERIVED_FROM` | Dashed line, opacity 0.2 | insight → source (future) |
| `REFERENCES` | Dashed line, opacity 0.2 | note → resource (future) |
| `TAGGED_WITH` | Dashed line, opacity 0.2 | resource → topic (future) |

### Data Transformation Layer (L3 Converter)

API response → graph library format:

```typescript
// converter: OntologyNode[] → GraphNode[]
interface GraphNode {
  id: string;           // node UUID
  label: string;        // node title (truncated to 30 chars)
  type: OntologyNodeType;
  category: 'structure' | 'content' | 'derived';
  val: number;          // node size (based on edge count)
}

// converter: OntologyEdge[] → GraphLink[]
interface GraphLink {
  source: string;       // source node UUID
  target: string;       // target node UUID
  relation: string;     // relation type code
  isStructural: boolean; // CONTAINS or PLACED_IN
}
```

---

## 3. UI Specification

### 3.1 View Integration — 4th View in ViewSwitcher

```
[Mandala] [Grid] [List] [Graph]  ← ViewSwitcher icon addition
```

- Entry point: same location, same interaction as existing view switches
- User perception: "another way to see the same data", not a new page
- Routing: no separate `/graph` route — managed by ViewSwitcher state (Zustand)

### 3.2 Layout — Existing Pattern Extension

```
┌──────────┬──────────────────────────────────────────┐
│          │  Header (title + filter chips + view sw) │
│ Sidebar  ├──────────────────────────────────────────┤
│ (22rem)  │                                          │
│          │   Graph Canvas                           │
│ - Nav    │   (full content area)                    │
│ - Mandala│                                          │
│   List   │   ┌─────────────────────────────────┐    │
│          │   │  Selected Node Detail            │    │
│          │   │  (ResizablePanel, slide-up)      │    │
│          │   └─────────────────────────────────┘    │
└──────────┴──────────────────────────────────────────┘
```

Key constraints:
- **No new panels created**. Reuse existing layout structure.
- **Left sidebar**: unchanged — mandala selection acts as graph filter
- **Main area**: Graph canvas fills the content area
- **Detail panel**: existing `ResizablePanel` pattern, slides up from bottom on node selection
- **Filters**: Header filter chips (reusing existing search filter UI pattern)

### 3.3 Color Strategy — Within Insighta 4-Color System

#### Node Colors (3-Category Classification, Muted Palette)

Insighta uses a single accent principle. Instead of 9 vivid colors, nodes use **semantic 3-category classification**:

| Category | Node Types | Color Token | Rationale |
|----------|-----------|-------------|-----------|
| **Structure** | mandala, mandala_sector, goal | `hsl(var(--primary))` (muted indigo) | Mandala = core structure |
| **Content** | resource, note, source, source_segment | `hsl(var(--foreground) / 0.6)` (muted gray) | Knowledge assets |
| **Derived** | insight, topic | `hsl(var(--primary) / 0.4)` (light indigo) | AI/user derivatives |

Visual rules:
- All nodes are **circles** — differentiation by size only (edge count → radius)
- Selected node: `primary` full opacity + `ring` effect (2px)
- Unselected nodes: category color at base opacity
- Light/dark mode: automatic via CSS custom properties

#### Edge Colors

All edges use `hsl(var(--border))` (muted gray):

| Edge Category | Style | Opacity | Examples |
|---------------|-------|---------|----------|
| Structural | Solid line | 0.4 | CONTAINS, PLACED_IN |
| Semantic | Dashed line | 0.2 | DERIVED_FROM, REFERENCES, TAGGED_WITH |
| Selected node's edges | Inherits style | 1.0 | Highlighted on selection |

### 3.4 Interaction Design

#### Selection & Navigation (List View Pattern)

| Action | Behavior | Existing Pattern Reference |
|--------|----------|---------------------------|
| Click | Select node → detail panel slides up | List view card click → detail panel |
| Hover | Connected nodes/edges highlight, others dim | Tooltip 200ms delay |
| Double-click | Zoom to node + expand neighbors | — |
| Canvas drag | Panning | — |
| Scroll | Zoom in/out | — |
| Esc | Deselect, close detail panel | List view Esc behavior |

#### Filter UI (Header Filter Chips Pattern)

Reuse existing search bar filter chip pattern:

```
[Graph View]  Type: [Structure ×] [Content ×] [Derived ×]   Mandala: [All ▾]
```

- 3-category toggle chips (not 9-type vivid filters)
- Mandala dropdown to scope to a specific mandala's subgraph
- Search: connects to existing Header search bar (node title FTS)

#### Detail Panel Content (on node selection)

| Field | Source |
|-------|--------|
| Title | `node.title` |
| Type | `node.type` (with category badge) |
| Created | `node.created_at` (relative time) |
| Properties | `node.properties` (key-value display) |
| Connections | Count of edges + list of connected node titles |
| Source link | If `source_ref` exists, link to original entity |

### 3.5 Empty & Loading States (Existing Patterns)

| State | UI | Pattern |
|-------|-----|---------|
| Loading | `Loader2` spinner centered | Existing loading pattern |
| 0 nodes | Icon + "No connected knowledge yet" + "Add cards to your mandala to build the graph automatically" | Empty state pattern |
| 0 search results | "No results found" | Existing search empty |
| Error | Toast notification | Existing error pattern |

---

## 4. Technical Specification

### ADR-6: Graph Visualization Library Selection

| Criterion | react-force-graph-2d | @xyflow/react | sigma.js + graphology |
|-----------|---------------------|---------------|----------------------|
| Force layout | Built-in (d3-force) | Manual | Built-in |
| React integration | Native component | Native | Wrapper needed |
| Performance (200 nodes) | Excellent | Excellent | Overkill |
| Performance (1000+ nodes) | Degrades | N/A (not for graphs) | Excellent |
| Node editing UI | Limited | Excellent | Limited |
| Bundle size | ~45KB | ~150KB | ~80KB |
| **Decision** | **Selected for MVP** | Future (if editing needed) | Future (if 1000+ nodes) |

**Rationale**: react-force-graph-2d provides force-directed layout with Canvas/WebGL rendering in a single React component. At current scale (~200 nodes), it offers the best developer experience and performance balance.

### State Management

```
graphViewStore (Zustand)
├── selectedNodeId: string | null
├── hoveredNodeId: string | null
├── filterCategories: Set<'structure' | 'content' | 'derived'>
├── filterMandalaId: string | null
├── zoomLevel: number
└── actions
    ├── selectNode(id)
    ├── hoverNode(id)
    ├── toggleCategory(category)
    ├── setMandalaFilter(id)
    └── resetFilters()
```

### Data Fetching (TanStack Query)

```typescript
// New hook: useGraphData
// Extends existing ontology query pattern
const useGraphData = (mandalaId?: string) => {
  return useQuery({
    queryKey: ['ontology', 'graph', mandalaId],
    queryFn: () => fetchGraphNodes({ domain: 'service', mandalaId }),
    staleTime: 5 * 60 * 1000, // 5 min (graph data is relatively stable)
  });
};
```

### Scaling Strategy

| Node Count | Strategy | Current State |
|------------|----------|---------------|
| ~200 | Full load, full simulation | **Current (177 nodes)** |
| 200–500 | Mandala-scoped initial load + lazy neighbor expansion | Short-term expected |
| 500+ | Cluster view (3 categories → click to expand) | Medium-term |
| 1000+ | Migrate to sigma.js + graphology | Long-term |

### Component Structure

```
frontend/src/components/graph/
├── GraphView.tsx              # Main view (rendered by ViewSwitcher)
├── GraphCanvas.tsx            # react-force-graph-2d wrapper
├── GraphNodeDetail.tsx        # Detail panel content
├── GraphFilterBar.tsx         # Filter chips for header
├── useGraphData.ts            # TanStack Query hook
├── useGraphViewStore.ts       # Zustand store
└── graph-converters.ts        # OntologyNode[] → GraphNode[]
```

---

## 5. MVP Scope (MA-2)

### Included

- [x] ViewSwitcher integration (4th view icon)
- [x] Full graph render of service-domain nodes/edges
- [x] 3-category color classification
- [x] Click to select → detail panel
- [x] Hover to highlight connections
- [x] Mandala filter (sidebar selection)
- [x] Category filter chips
- [x] Empty state, loading state
- [x] Light/dark mode support
- [x] Mandala-centric layout (selected mandala as center)

### Excluded from MVP

- [ ] Double-click neighbor expansion (deferred to MA-2.1)
- [ ] Search-to-highlight integration (deferred)
- [ ] Node editing from graph (MA-3+)
- [ ] AI-generated insights/topics rendering (MA-3+)
- [ ] Graph export (image/data)
- [ ] Minimap / overview panel

---

## 6. Acceptance Criteria

| # | Criterion | Verification |
|---|-----------|-------------|
| AC-1 | Graph view accessible via ViewSwitcher as 4th option | Manual: click Graph icon in ViewSwitcher |
| AC-2 | All service-domain nodes rendered (no system nodes) | Verify node count matches `GET /api/ontology/stats` service count |
| AC-3 | Nodes colored by 3-category system using design tokens | Visual: compare against Insighta 4-color palette |
| AC-4 | Click node → detail panel opens with node info | Manual: click any node, verify panel content |
| AC-5 | Hover node → connected nodes/edges highlighted | Manual: hover and observe dimming |
| AC-6 | Mandala sidebar selection filters graph | Manual: select mandala, verify graph scope |
| AC-7 | Category filter chips toggle node visibility | Manual: toggle each chip |
| AC-8 | Empty state shown when no nodes exist | Test with empty ontology |
| AC-9 | Works in both light and dark mode | Manual: toggle theme |
| AC-10 | Mandala-centric layout: selected mandala centered with sectors radially arranged | Manual: select mandala from sidebar |
| AC-11 | Performance: initial render < 2s for 200 nodes | Performance measurement |
| AC-12 | No Obsidian design elements (vivid colors, glow, dark-only bg) | Design review |

---

## 7. Design Direction — Insighta Minimal Principles

### What This Is NOT

This is not an Obsidian Graph View clone. The following Obsidian characteristics are explicitly **rejected**:

| Obsidian Element | Rejection Reason | Insighta Alternative |
|-----------------|------------------|---------------------|
| 9-color vivid node palette | Violates single-accent principle | 3-category muted classification |
| Dark navy background (`#1a1a2e`) | Light/dark mode support required | `surface-base` token |
| Glow/bloom effects on nodes | Decorative element (removed in #118) | Flat circles with ring on selection |
| Force/physics sliders | Over-configuration for end users | Auto-optimized physics |
| Dedicated full-page layout | Inconsistent with existing UX | ViewSwitcher integration |
| Separate filter sidebar | Redundant with existing sidebar | Existing sidebar + header chips |

### What This IS

- **Clean**: white/dark background, muted colors, thin borders
- **Integrated**: feels like a natural extension of Grid/List views
- **Mandala-first**: the mandala structure is the organizing principle of the graph
- **Minimal interaction**: click, hover, filter — no configuration panels
- **Token-based**: all colors from CSS custom properties, automatic theme support

### Mandala-Centric View — Insighta's Unique Selling Point

The differentiating feature that no other graph tool provides:

1. Sidebar mandala selection → that mandala becomes the **center node**
2. `CONTAINS` edges radiate outward → sectors arranged in a circle around the mandala
3. Each sector's resources cluster around their sector
4. The mandala grid structure **transforms into a graph layout** visually
5. Users see their knowledge organized by their own goal framework

This is "mandala-as-constellation" — the user's goals as the gravitational centers of their knowledge universe.
