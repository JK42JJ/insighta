/**
 * Unit tests for GraphDB Context Builder
 * Issue: #252 (MA-2: GraphDB Service Layer)
 */

// Mock graph.ts before importing context-builder
jest.mock('@/modules/ontology/graph', () => ({
  getSubgraph: jest.fn(),
}));

import { buildContext, buildNodeContext } from '@/modules/ontology/context-builder';
import { getSubgraph } from '@/modules/ontology/graph';

const mockedGetSubgraph = getSubgraph as jest.MockedFunction<typeof getSubgraph>;

const MOCK_USER_ID = '0192fedf-85f4-47ab-a652-7fdd116e2b39';

const MOCK_SUBGRAPH = {
  nodes: [
    {
      id: 'node-1',
      type: 'resource',
      title: 'React Performance',
      properties: { url: 'https://youtube.com/watch?v=abc', user_note: 'useMemo 정리' },
    },
    {
      id: 'node-2',
      type: 'topic',
      title: 'React Hooks',
      properties: { description: 'React hooks overview' },
    },
    {
      id: 'node-3',
      type: 'source',
      title: 'YouTube: React Conf 2024',
      properties: { url: 'https://youtube.com/watch?v=xyz' },
    },
  ],
  edges: [
    { id: 'edge-1', source_id: 'node-1', target_id: 'node-2', relation: 'related_to', weight: 0.8 },
    { id: 'edge-2', source_id: 'node-1', target_id: 'node-3', relation: 'derived_from', weight: 1 },
  ],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockedGetSubgraph.mockResolvedValue(MOCK_SUBGRAPH);
});

describe('buildContext', () => {
  it('should format nodes and edges into structured text', async () => {
    const result = await buildContext(['node-1'], MOCK_USER_ID);

    expect(result.nodeCount).toBe(3);
    expect(result.edgeCount).toBe(2);
    expect(result.truncated).toBe(false);
    expect(result.text).toContain('[resource] "React Performance"');
    expect(result.text).toContain('[topic] "React Hooks"');
    expect(result.text).toContain('--[related_to]-->');
    expect(result.text).toContain('(weight: 0.8)');
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it('should include node properties when includeProperties is true', async () => {
    const result = await buildContext(['node-1'], MOCK_USER_ID, { includeProperties: true });

    expect(result.text).toContain('url: https://youtube.com/watch?v=abc');
    expect(result.text).toContain('user_note: useMemo 정리');
  });

  it('should exclude node properties when includeProperties is false', async () => {
    const result = await buildContext(['node-1'], MOCK_USER_ID, { includeProperties: false });

    expect(result.text).not.toContain('url:');
    expect(result.text).not.toContain('user_note:');
    expect(result.text).toContain('[resource] "React Performance"');
  });

  it('should exclude edges when includeEdges is false', async () => {
    const result = await buildContext(['node-1'], MOCK_USER_ID, { includeEdges: false });

    expect(result.edgeCount).toBe(0);
    expect(result.text).not.toContain('Relationships');
    expect(result.text).not.toContain('--[');
  });

  it('should truncate when exceeding maxTokens', async () => {
    // Very small token limit to force truncation
    const result = await buildContext(['node-1'], MOCK_USER_ID, { maxTokens: 20 });

    expect(result.truncated).toBe(true);
    expect(result.estimatedTokens).toBeLessThanOrEqual(20);
  });

  it('should omit weight display when weight is 1', async () => {
    const result = await buildContext(['node-1'], MOCK_USER_ID);

    // edge-2 has weight: 1, should not show "(weight: 1)"
    const derivedLine = result.text.split('\n').find((l) => l.includes('derived_from'));
    expect(derivedLine).toBeDefined();
    expect(derivedLine).not.toContain('weight:');
  });

  it('should merge subgraphs from multiple seed nodes', async () => {
    const result = await buildContext(['node-1', 'node-2'], MOCK_USER_ID);

    // getSubgraph called twice (once per seed node)
    expect(mockedGetSubgraph).toHaveBeenCalledTimes(2);
    // Nodes deduplicated by ID
    expect(result.nodeCount).toBe(3);
  });

  it('should handle empty subgraph', async () => {
    mockedGetSubgraph.mockResolvedValue({ nodes: [], edges: [] });

    const result = await buildContext(['nonexistent'], MOCK_USER_ID);

    expect(result.nodeCount).toBe(0);
    expect(result.edgeCount).toBe(0);
    expect(result.text).toBe('');
  });
});

describe('buildNodeContext', () => {
  it('should delegate to buildContext with single nodeId', async () => {
    const result = await buildNodeContext('node-1', MOCK_USER_ID);

    expect(mockedGetSubgraph).toHaveBeenCalledWith('node-1', MOCK_USER_ID, 2);
    expect(result.nodeCount).toBe(3);
  });

  it('should pass options through', async () => {
    const opts = { maxTokens: 500, includeEdges: false, depth: 1 };
    await buildNodeContext('node-1', MOCK_USER_ID, opts);

    expect(mockedGetSubgraph).toHaveBeenCalledWith('node-1', MOCK_USER_ID, 1);
  });
});
