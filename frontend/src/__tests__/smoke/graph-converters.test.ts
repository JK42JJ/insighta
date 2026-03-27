import { describe, it, expect } from 'vitest';
import {
  convertNode,
  convertEdge,
  buildGraphData,
} from '@/components/graph/graph-converters';
import type { OntologyNode, OntologyEdge } from '@/components/graph/types';

const NOW = '2026-03-27T00:00:00Z';

function makeNode(overrides: Partial<OntologyNode> = {}): OntologyNode {
  return {
    id: 'node-1',
    user_id: 'user-1',
    type: 'resource',
    title: 'Test Node',
    properties: {},
    source_ref: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeEdge(overrides: Partial<OntologyEdge> = {}): OntologyEdge {
  return {
    id: 'edge-1',
    user_id: 'user-1',
    source_id: 'node-1',
    target_id: 'node-2',
    relation: 'REFERENCES',
    weight: 1,
    properties: {},
    created_at: NOW,
    ...overrides,
  };
}

describe('convertNode', () => {
  it('converts OntologyNode to GraphNode with correct fields', () => {
    const edgeCountMap = new Map([['node-1', 3]]);
    const result = convertNode(makeNode(), edgeCountMap);

    expect(result).toEqual({
      id: 'node-1',
      label: 'Test Node',
      fullTitle: 'Test Node',
      type: 'resource',
      category: 'content',
      val: 4, // edgeCount(3) + 1
      properties: {},
    });
  });

  it('truncates long labels with ellipsis', () => {
    const longTitle = 'A'.repeat(50);
    const node = makeNode({ title: longTitle });
    const result = convertNode(node, new Map());

    expect(result.label).toHaveLength(30);
    expect(result.label.endsWith('…')).toBe(true);
    expect(result.fullTitle).toBe(longTitle);
  });

  it('classifies structure nodes correctly', () => {
    const mandalaNode = makeNode({ type: 'mandala' });
    const result = convertNode(mandalaNode, new Map());
    expect(result.category).toBe('structure');
  });

  it('classifies derived nodes correctly', () => {
    const insightNode = makeNode({ type: 'insight' });
    const result = convertNode(insightNode, new Map());
    expect(result.category).toBe('derived');
  });

  it('clamps val between 1 and 10', () => {
    const noEdges = convertNode(makeNode(), new Map());
    expect(noEdges.val).toBe(1); // max(1, min(0+1, 10)) = 1

    const manyEdges = convertNode(
      makeNode(),
      new Map([['node-1', 20]])
    );
    expect(manyEdges.val).toBe(10); // max(1, min(21, 10)) = 10
  });
});

describe('convertEdge', () => {
  it('converts OntologyEdge to GraphLink', () => {
    const result = convertEdge(makeEdge());
    expect(result).toEqual({
      source: 'node-1',
      target: 'node-2',
      relation: 'REFERENCES',
      isStructural: false,
    });
  });

  it('marks CONTAINS as structural', () => {
    const result = convertEdge(makeEdge({ relation: 'CONTAINS' }));
    expect(result.isStructural).toBe(true);
  });

  it('marks PLACED_IN as structural', () => {
    const result = convertEdge(makeEdge({ relation: 'PLACED_IN' }));
    expect(result.isStructural).toBe(true);
  });
});

describe('buildGraphData', () => {
  it('builds graph data from nodes and edges', () => {
    const nodes = [
      makeNode({ id: 'n1', title: 'Node 1' }),
      makeNode({ id: 'n2', title: 'Node 2' }),
    ];
    const edges = [
      makeEdge({ source_id: 'n1', target_id: 'n2' }),
    ];

    const result = buildGraphData(nodes, edges);
    expect(result.nodes).toHaveLength(2);
    expect(result.links).toHaveLength(1);
    expect(result.links[0].source).toBe('n1');
    expect(result.links[0].target).toBe('n2');
  });

  it('filters edges with missing endpoints', () => {
    const nodes = [makeNode({ id: 'n1' })];
    const edges = [
      makeEdge({ source_id: 'n1', target_id: 'n-missing' }),
    ];

    const result = buildGraphData(nodes, edges);
    expect(result.links).toHaveLength(0);
  });

  it('computes edge count for node sizing', () => {
    const nodes = [
      makeNode({ id: 'n1' }),
      makeNode({ id: 'n2' }),
      makeNode({ id: 'n3' }),
    ];
    const edges = [
      makeEdge({ source_id: 'n1', target_id: 'n2' }),
      makeEdge({ id: 'e2', source_id: 'n1', target_id: 'n3' }),
    ];

    const result = buildGraphData(nodes, edges);
    const n1 = result.nodes.find((n) => n.id === 'n1');
    // n1 has 2 edges → val = min(2+1, 10) = 3
    expect(n1?.val).toBe(3);
  });

  it('handles empty inputs', () => {
    const result = buildGraphData([], []);
    expect(result).toEqual({ nodes: [], links: [] });
  });
});
