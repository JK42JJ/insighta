// ============================================================================
// Graph Data Hook (TanStack Query)
// Fetches ontology nodes/edges and converts to graph format.
// ============================================================================

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import apiClient from '@/shared/lib/api-client';
import type { OntologyNode, OntologyEdge, OntologyStats, GraphData } from './types';
import { buildGraphData } from './graph-converters';

// -- API response types --

interface ListNodesResponse {
  status: string;
  data: { nodes: OntologyNode[]; total: number };
}

interface StatsResponse {
  status: string;
  data: OntologyStats;
}

// -- API functions (use apiClient.request via class extension) --
// Since apiClient.request is private, we use fetch directly with the same auth pattern.

async function fetchWithAuth(endpoint: string): Promise<unknown> {
  await apiClient.tokenReady;
  const token = apiClient.getAccessToken();
  const baseUrl = (apiClient as unknown as { baseUrl: string }).baseUrl;
  const url = `${baseUrl}/api/v1/ontology${endpoint}`;

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`Ontology API error: ${response.status}`);
  }

  return response.json();
}

async function fetchServiceNodes(limit: number = 1000): Promise<OntologyNode[]> {
  const data = (await fetchWithAuth(`/nodes?domain=service&limit=${limit}`)) as ListNodesResponse;
  return data.data.nodes;
}

interface ListEdgesResponse {
  status: string;
  data: { edges: OntologyEdge[]; total: number };
}

async function fetchEdges(): Promise<OntologyEdge[]> {
  const data = (await fetchWithAuth('/edges?domain=service&limit=1000')) as ListEdgesResponse;
  return data.data.edges;
}

async function fetchStats(): Promise<OntologyStats> {
  const data = (await fetchWithAuth('/stats')) as StatsResponse;
  return data.data;
}

// -- Query keys --

const GRAPH_QUERY_KEYS = {
  nodes: (domain: string) => ['ontology', 'nodes', domain] as const,
  edges: () => ['ontology', 'edges'] as const,
  stats: () => ['ontology', 'stats'] as const,
  graphData: (domain: string) => ['ontology', 'graphData', domain] as const,
};

const STALE_TIME = 2 * 60 * 1000; // 2 minutes

// -- Hooks --

export function useOntologyNodes(domain: string = 'service') {
  return useQuery({
    queryKey: GRAPH_QUERY_KEYS.nodes(domain),
    queryFn: () => fetchServiceNodes(),
    staleTime: STALE_TIME,
  });
}

export function useOntologyStats() {
  return useQuery({
    queryKey: GRAPH_QUERY_KEYS.stats(),
    queryFn: fetchStats,
    staleTime: STALE_TIME,
  });
}

export function useGraphData(mandalaId?: string | null): {
  data: GraphData | undefined;
  mandalaNodeIds: Set<string>;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
} {
  const nodesQuery = useOntologyNodes('service');
  const edgesQuery = useQuery({
    queryKey: GRAPH_QUERY_KEYS.edges(),
    queryFn: fetchEdges,
    staleTime: STALE_TIME,
  });

  const isLoading = nodesQuery.isLoading || edgesQuery.isLoading;
  const isError = nodesQuery.isError || edgesQuery.isError;
  const error = nodesQuery.error ?? edgesQuery.error ?? null;

  const data =
    nodesQuery.data && edgesQuery.data
      ? buildGraphData(nodesQuery.data, edgesQuery.data)
      : undefined;

  // Compute node IDs belonging to the selected mandala's structure subtree
  const mandalaNodeIds = useMemo(() => {
    if (!mandalaId || !nodesQuery.data || !edgesQuery.data) return new Set<string>();

    // Find the mandala root node by source_ref
    const mandalaNode = nodesQuery.data.find(
      (n) => n.source_ref?.table === 'user_mandalas' && n.source_ref.id === mandalaId
    );
    if (!mandalaNode) return new Set<string>();

    // BFS: traverse CONTAINS edges from mandala root to find all structure nodes
    const ids = new Set<string>([mandalaNode.id]);
    const queue = [mandalaNode.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of edgesQuery.data) {
        if (edge.source_id === current && edge.relation === 'CONTAINS' && !ids.has(edge.target_id)) {
          ids.add(edge.target_id);
          queue.push(edge.target_id);
        }
      }
    }
    return ids;
  }, [mandalaId, nodesQuery.data, edgesQuery.data]);

  return { data, mandalaNodeIds, isLoading, isError, error };
}
