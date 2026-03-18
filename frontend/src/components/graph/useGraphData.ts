// ============================================================================
// Graph Data Hook (TanStack Query)
// Fetches ontology nodes/edges and converts to graph format.
// ============================================================================

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

async function fetchServiceNodes(limit: number = 100): Promise<OntologyNode[]> {
  const data = (await fetchWithAuth(`/nodes?domain=service&limit=${limit}`)) as ListNodesResponse;
  return data.data.nodes;
}

async function fetchEdges(): Promise<OntologyEdge[]> {
  // Edges endpoint doesn't have a list-all; we use stats to check if edges exist
  // For now, return empty — edges will be populated as the graph grows
  // TODO: Add GET /edges list endpoint when needed
  return [];
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

export function useGraphData(): {
  data: GraphData | undefined;
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

  return { data, isLoading, isError, error };
}
