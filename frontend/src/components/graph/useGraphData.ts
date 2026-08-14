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

interface SubgraphResponse {
  status: string;
  data: { nodes: OntologyNode[]; edges: OntologyEdge[]; truncated: boolean };
}

/** The user's WHOLE knowledge graph (every mandala's structure + every
 *  placed card, server-side projections included). The active mandala is a
 *  client-side highlight, not a scope (2026-07-28 scope decision). */
async function fetchUserGraph(): Promise<{
  nodes: OntologyNode[];
  edges: OntologyEdge[];
  truncated: boolean;
}> {
  const data = (await fetchWithAuth('/subgraph')) as SubgraphResponse;
  return data.data;
}

async function fetchStats(): Promise<OntologyStats> {
  const data = (await fetchWithAuth('/stats')) as StatsResponse;
  return data.data;
}

// -- Query keys --

const GRAPH_QUERY_KEYS = {
  nodes: (domain: string) => ['ontology', 'nodes', domain] as const,
  edges: () => ['ontology', 'edges'] as const,
  subgraph: (mandalaId: string) => ['ontology', 'subgraph', mandalaId] as const,
  stats: () => ['ontology', 'stats'] as const,
  graphData: (domain: string) => ['ontology', 'graphData', domain] as const,
};

const STALE_TIME = 2 * 60 * 1000; // 2 minutes

// -- Hooks --

export function useOntologyNodes(domain: string = 'service', enabled: boolean = true) {
  return useQuery({
    queryKey: GRAPH_QUERY_KEYS.nodes(domain),
    queryFn: () => fetchServiceNodes(),
    staleTime: STALE_TIME,
    enabled,
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
  // ALWAYS the user's whole knowledge graph — the active mandala only drives
  // the client-side highlight below (2026-07-28 scope decision).
  const subgraphQuery = useQuery({
    queryKey: GRAPH_QUERY_KEYS.subgraph('user-wide'),
    queryFn: fetchUserGraph,
    staleTime: STALE_TIME,
  });

  const isLoading = subgraphQuery.isLoading;
  const isError = subgraphQuery.isError;
  const error = subgraphQuery.error ?? null;

  const rawNodes = subgraphQuery.data?.nodes;
  const rawEdges = subgraphQuery.data?.edges;

  // MUST be referentially stable: GraphCanvas keys its graphology build (and
  // sigma instance lifetime) on this object. Rebuilding it every render was
  // the root of the interaction flicker — each hover re-render produced a new
  // data object → new graph → sigma torn down and recreated mid-interaction
  // (and, in prod scheduling, refresh() could land on the killed instance =
  // "could not find a suitable program" crash).
  const data = useMemo(
    () => (rawNodes && rawEdges ? buildGraphData(rawNodes, rawEdges) : undefined),
    [rawNodes, rawEdges]
  );

  // Compute node IDs belonging to the selected mandala's structure subtree
  const mandalaNodeIds = useMemo(() => {
    if (!mandalaId || !rawNodes || !rawEdges) return new Set<string>();

    // Find the mandala root node by source_ref
    const mandalaNode = rawNodes.find(
      (n) => n.source_ref?.table === 'user_mandalas' && n.source_ref.id === mandalaId
    );
    if (!mandalaNode) return new Set<string>();

    // BFS from the mandala root over structural relations. PLACED_IN carries
    // the card placements (server-side projections), so the highlight covers
    // the mandala's cards too, not just its skeleton.
    const ids = new Set<string>([mandalaNode.id]);
    const queue = [mandalaNode.id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of rawEdges) {
        if (
          edge.source_id === current &&
          (edge.relation === 'CONTAINS' || edge.relation === 'PLACED_IN') &&
          !ids.has(edge.target_id)
        ) {
          ids.add(edge.target_id);
          queue.push(edge.target_id);
        }
      }
    }
    return ids;
  }, [mandalaId, rawNodes, rawEdges]);

  return { data, mandalaNodeIds, isLoading, isError, error };
}
