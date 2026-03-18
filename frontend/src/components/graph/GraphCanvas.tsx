// ============================================================================
// GraphCanvas — react-force-graph-2d wrapper
// Renders the knowledge graph with category-based coloring.
// ============================================================================

import { useRef, useCallback, useEffect } from 'react';
import ForceGraph2D, { type ForceGraphMethods } from 'react-force-graph-2d';
import type { GraphData, GraphNode, NodeCategory } from './types';
import { STRUCTURAL_RELATIONS } from './types';

interface GraphCanvasProps {
  data: GraphData;
  selectedNodeId: string | null;
  hoveredNodeId: string | null;
  categoryFilter: Set<NodeCategory>;
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
  onNodeClick,
  onNodeHover,
  width,
  height,
}: GraphCanvasProps) {
  const fgRef = useRef<ForceGraphMethods<GraphNode>>(null);
  const isDark = document.documentElement.classList.contains('dark');

  // Filter nodes by category
  const filteredNodeIds = new Set(
    data.nodes.filter((n) => categoryFilter.has(n.category)).map((n) => n.id)
  );

  const filteredData: GraphData = {
    nodes: data.nodes.filter((n) => filteredNodeIds.has(n.id)),
    links: data.links.filter(
      (l) => filteredNodeIds.has(l.source as string) && filteredNodeIds.has(l.target as string)
    ),
  };

  // Connected nodes for hover highlight
  const connectedNodes = new Set<string>();
  if (hoveredNodeId || selectedNodeId) {
    const targetId = hoveredNodeId ?? selectedNodeId;
    connectedNodes.add(targetId!);
    for (const link of data.links) {
      const src = typeof link.source === 'string' ? link.source : (link.source as unknown as GraphNode).id;
      const tgt = typeof link.target === 'string' ? link.target : (link.target as unknown as GraphNode).id;
      if (src === targetId) connectedNodes.add(tgt);
      if (tgt === targetId) connectedNodes.add(src);
    }
  }

  const hasHighlight = hoveredNodeId !== null || selectedNodeId !== null;

  // Node rendering
  const nodeCanvasObject = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D) => {
      const x = (node as unknown as { x: number }).x;
      const y = (node as unknown as { y: number }).y;
      const radius = Math.sqrt(node.val) * 3 + 2;

      const isSelected = node.id === selectedNodeId;
      const isConnected = connectedNodes.has(node.id);
      const dimmed = hasHighlight && !isConnected;

      const baseColor = getCategoryColor(node.category, isDark);
      const alpha = dimmed ? 0.15 : 1;

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = baseColor;
      ctx.globalAlpha = alpha;
      ctx.fill();

      // Selection ring
      if (isSelected) {
        ctx.strokeStyle = getCategoryColor('structure', isDark);
        ctx.lineWidth = 2;
        ctx.globalAlpha = 1;
        ctx.stroke();
      }

      // Label for larger/selected nodes
      if (radius > 4 || isSelected) {
        ctx.globalAlpha = dimmed ? 0.1 : 0.8;
        ctx.fillStyle = isDark ? '#e0e0e0' : '#333';
        ctx.font = `${isSelected ? 'bold ' : ''}${Math.max(10, radius)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.fillText(node.label, x, y + radius + 2);
      }

      ctx.globalAlpha = 1;
    },
    [selectedNodeId, connectedNodes, hasHighlight, isDark]
  );

  // Link rendering
  const linkColor = useCallback(
    (link: { source: unknown; target: unknown; relation: string }) => {
      const src = typeof link.source === 'string' ? link.source : (link.source as GraphNode).id;
      const tgt = typeof link.target === 'string' ? link.target : (link.target as GraphNode).id;
      const isConnected = connectedNodes.has(src) && connectedNodes.has(tgt);
      const isStructural = STRUCTURAL_RELATIONS.has(link.relation);

      if (hasHighlight && !isConnected) return isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)';
      if (isStructural) return isDark ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.2)';
      return isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)';
    },
    [connectedNodes, hasHighlight, isDark]
  );

  // Zoom to fit on data change
  useEffect(() => {
    if (fgRef.current && filteredData.nodes.length > 0) {
      setTimeout(() => fgRef.current?.zoomToFit(400, 40), 300);
    }
  }, [filteredData.nodes.length]);

  const handleClick = useCallback(
    (node: GraphNode) => {
      onNodeClick(node.id === selectedNodeId ? null : node.id);
    },
    [onNodeClick, selectedNodeId]
  );

  const handleHover = useCallback(
    (node: GraphNode | null) => {
      onNodeHover(node?.id ?? null);
    },
    [onNodeHover]
  );

  return (
    <ForceGraph2D
      ref={fgRef}
      graphData={filteredData}
      width={width}
      height={height}
      nodeCanvasObject={nodeCanvasObject}
      nodePointerAreaPaint={(node, color, ctx) => {
        const x = (node as unknown as { x: number }).x;
        const y = (node as unknown as { y: number }).y;
        const radius = Math.sqrt(node.val) * 3 + 4;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, 2 * Math.PI);
        ctx.fillStyle = color;
        ctx.fill();
      }}
      linkColor={linkColor}
      linkWidth={(link) => (STRUCTURAL_RELATIONS.has(link.relation) ? 1.5 : 0.5)}
      linkLineDash={(link) => (STRUCTURAL_RELATIONS.has(link.relation) ? [] : [4, 2])}
      onNodeClick={handleClick}
      onNodeHover={handleHover}
      onBackgroundClick={() => onNodeClick(null)}
      cooldownTicks={100}
      d3AlphaDecay={0.04}
      d3VelocityDecay={0.3}
      enableNodeDrag={false}
    />
  );
}
