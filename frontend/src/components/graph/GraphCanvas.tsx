// ============================================================================
// GraphCanvas — react-force-graph-2d wrapper
// Renders the knowledge graph with category-based coloring.
// ============================================================================

import { useRef, useCallback, useEffect, useMemo } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import type { GraphData, GraphNode, NodeCategory } from './types';
import { STRUCTURAL_RELATIONS } from './types';

interface GraphCanvasProps {
  data: GraphData;
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  categoryFilter: Set<NodeCategory>;
  mandalaNodeIds: Set<string>;
  onNodeClick: (id: string | null) => void;
  onNodeHover: (id: string | null) => void;
  width: number;
  height: number;
}

// Category colors (resolved from CSS at runtime)
function getCategoryColor(category: NodeCategory, isDark: boolean): string {
  switch (category) {
    case 'structure':
      return isDark ? 'hsl(224, 60%, 65%)' : 'hsl(224, 60%, 50%)';
    case 'content':
      return isDark ? 'hsl(220, 10%, 60%)' : 'hsl(220, 10%, 45%)';
    case 'derived':
      return isDark ? 'hsl(224, 40%, 55%)' : 'hsl(224, 40%, 65%)';
  }
}

export function GraphCanvas({
  data,
  selectedNodeId,
  hoveredNodeId,
  categoryFilter,
  mandalaNodeIds,
  onNodeClick,
  onNodeHover,
  width,
  height,
}: GraphCanvasProps) {
  const fgRef = useRef<ForceGraphMethods<GraphNode>>(null);

  // Filter nodes by category (stabilized with useMemo)
  const filteredData = useMemo<GraphData>(() => {
    const filteredNodeIds = new Set(
      data.nodes.filter((n) => categoryFilter.has(n.category)).map((n) => n.id)
    );
    return {
      nodes: data.nodes.filter((n) => filteredNodeIds.has(n.id)),
      links: data.links.filter(
        (l) => filteredNodeIds.has(l.source as string) && filteredNodeIds.has(l.target as string)
      ),
    };
  }, [data, categoryFilter]);

  // Connected nodes for hover highlight (stabilized with useMemo)
  const connectedNodes = useMemo(() => {
    const set = new Set<string>();
    if (hoveredNodeId || selectedNodeId) {
      const targetId = hoveredNodeId ?? selectedNodeId;
      set.add(targetId!);
      for (const link of data.links) {
        const src = typeof link.source === 'string' ? link.source : (link.source as unknown as GraphNode).id;
        const tgt = typeof link.target === 'string' ? link.target : (link.target as unknown as GraphNode).id;
        if (src === targetId) set.add(tgt);
        if (tgt === targetId) set.add(src);
      }
    }
    return set;
  }, [hoveredNodeId, selectedNodeId, data.links]);

  const hasHighlight = hoveredNodeId !== null || selectedNodeId !== null;

  const hasMandalaHighlight = mandalaNodeIds.size > 0;

  // Ref pattern: stable callback functions read changing state via ref
  const stateRef = useRef({ connectedNodes, hasHighlight, selectedNodeId, mandalaNodeIds, hasMandalaHighlight, isDark: false });
  stateRef.current = {
    connectedNodes,
    hasHighlight,
    selectedNodeId,
    mandalaNodeIds,
    hasMandalaHighlight,
    isDark: document.documentElement.classList.contains('dark'),
  };

  // Node rendering (stable — empty deps, reads state via ref)
  const nodeCanvasObject = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D) => {
      const s = stateRef.current;
      const x = (node as unknown as { x: number }).x;
      const y = (node as unknown as { y: number }).y;
      const radius = Math.sqrt(node.val) * 3 + 2;

      const isSelected = node.id === s.selectedNodeId;
      const isConnected = s.connectedNodes.has(node.id);
      const isMandalaNode = s.mandalaNodeIds.has(node.id);

      // Priority: hover/select highlight > mandala highlight > default
      let alpha = 1;
      if (s.hasHighlight) {
        alpha = isConnected ? 1 : 0.15;
      } else if (s.hasMandalaHighlight) {
        alpha = isMandalaNode ? 1 : 0.35;
      }

      const baseColor = getCategoryColor(node.category, s.isDark);

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = baseColor;
      ctx.globalAlpha = alpha;
      ctx.fill();

      // Selection ring
      if (isSelected) {
        ctx.strokeStyle = getCategoryColor('structure', s.isDark);
        ctx.lineWidth = 2;
        ctx.globalAlpha = 1;
        ctx.stroke();
      }

      // Label for larger/selected nodes
      if (radius > 4 || isSelected) {
        ctx.globalAlpha = alpha < 1 ? alpha * 0.5 : 0.8;
        ctx.fillStyle = s.isDark ? '#e0e0e0' : '#333';
        ctx.font = `${isSelected ? 'bold ' : ''}${Math.max(10, radius)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(node.label, x, y + radius + 2);
      }

      ctx.globalAlpha = 1;
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Link rendering (stable — empty deps, reads state via ref)
  const linkColor = useCallback(
    (link: { source: unknown; target: unknown; relation: string }) => {
      const s = stateRef.current;
      const src = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id;
      const tgt = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id;
      const isConnected = s.connectedNodes.has(src) && s.connectedNodes.has(tgt);
      const isStructural = STRUCTURAL_RELATIONS.has(link.relation);
      const isMandalaEdge = s.mandalaNodeIds.has(src) && s.mandalaNodeIds.has(tgt);

      // Priority: hover/select > mandala highlight > default
      if (s.hasHighlight && !isConnected) return s.isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';
      if (s.hasMandalaHighlight && !isMandalaEdge) return s.isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
      if (isStructural) return s.isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)';
      return s.isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Zoom to fit on data change
  useEffect(() => {
    if (fgRef.current && filteredData.nodes.length > 0) {
      setTimeout(() => fgRef.current?.zoomToFit(400, 40), 300);
    }
  }, [filteredData.nodes.length]);

  const handleClick = useCallback(
    (node: GraphNode) => {
      onNodeClick(node.id === stateRef.current.selectedNodeId ? null : node.id);
    },
    [onNodeClick]
  );

  const handleHover = useCallback(
    (node: GraphNode | null) => {
      onNodeHover(node?.id ?? null);
    },
    [onNodeHover]
  );

  // Stable callbacks — prevent ForceGraph2D re-initialization on every render
  const nodePointerAreaPaint = useCallback(
    (node: GraphNode, color: string, ctx: CanvasRenderingContext2D) => {
      const x = (node as unknown as { x: number }).x;
      const y = (node as unknown as { y: number }).y;
      const radius = Math.sqrt(node.val) * 3 + 4;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
    },
    []
  );

  const handleLinkWidth = useCallback(
    (link: { relation: string }) => (STRUCTURAL_RELATIONS.has(link.relation) ? 1.5 : 0.5),
    []
  );

  const handleLinkLineDash = useCallback(
    (link: { relation: string }) => (STRUCTURAL_RELATIONS.has(link.relation) ? [] : [4, 2]),
    []
  );

  const handleBackgroundClick = useCallback(() => onNodeClick(null), [onNodeClick]);

  return (
    <ForceGraph2D
      ref={fgRef}
      graphData={filteredData}
      width={width}
      height={height}
      nodeCanvasObject={nodeCanvasObject}
      nodePointerAreaPaint={nodePointerAreaPaint}
      linkColor={linkColor}
      linkWidth={handleLinkWidth}
      linkLineDash={handleLinkLineDash}
      onNodeClick={handleClick}
      onNodeHover={handleHover}
      onBackgroundClick={handleBackgroundClick}
      warmupTicks={30}
      cooldownTicks={50}
      d3AlphaDecay={0.04}
      d3VelocityDecay={0.3}
      enableNodeDrag={false}
    />
  );
}
