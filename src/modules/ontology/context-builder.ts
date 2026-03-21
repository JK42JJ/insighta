/**
 * GraphDB Context Builder — subgraph → LLM prompt formatter
 *
 * Converts graph nodes and edges into structured text for LLM prompts.
 * Used by chatbot, report generation, and summarization services.
 * Issue: #252 (MA-2: GraphDB Service Layer)
 */

import { getSubgraph } from './graph';
import type { SubgraphResult } from './graph';

// Rough token estimation: ~4 chars per token
const CHARS_PER_TOKEN = 4;

export interface ContextOptions {
  /** Max estimated tokens for the output (default: 2000) */
  maxTokens?: number;
  /** Include edge relationships in context (default: true) */
  includeEdges?: boolean;
  /** Include node properties in context (default: true) */
  includeProperties?: boolean;
  /** Graph traversal depth (default: 2, max: 3) */
  depth?: number;
}

export interface ContextResult {
  /** Formatted context text ready for LLM prompt injection */
  text: string;
  /** Estimated token count */
  estimatedTokens: number;
  /** Whether the context was truncated to fit maxTokens */
  truncated: boolean;
  /** Number of nodes included */
  nodeCount: number;
  /** Number of edges included */
  edgeCount: number;
}

/** Property keys that carry meaningful text for context */
const TEXT_PROPERTY_KEYS = [
  'user_note', 'content', 'description', 'url',
  'summary', 'summary_en', 'summary_ko',
  'subjects', 'summary_tags',
] as const;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Format a single node into a text line.
 *
 * Example output:
 *   [resource] "React Performance" (url: youtube.com/..., user_note: "useMemo 정리")
 */
function formatNode(
  node: SubgraphResult['nodes'][number],
  includeProperties: boolean,
): string {
  let line = `[${node.type}] "${node.title}"`;

  if (includeProperties && node.properties) {
    const props: string[] = [];
    for (const key of TEXT_PROPERTY_KEYS) {
      const value = node.properties[key];
      if (!value) continue;

      if (Array.isArray(value)) {
        props.push(`${key}: ${(value as string[]).join(', ')}`);
      } else {
        const str = String(value);
        // Truncate long values to keep context concise
        const truncated = str.length > 200 ? str.slice(0, 200) + '...' : str;
        props.push(`${key}: ${truncated}`);
      }
    }

    if (props.length > 0) {
      line += ` (${props.join(', ')})`;
    }
  }

  return line;
}

/**
 * Format a single edge into a text line.
 *
 * Example output:
 *   "React Performance" --[related_to]--> "React Hooks" (weight: 0.8)
 */
function formatEdge(
  edge: SubgraphResult['edges'][number],
  nodeMap: Map<string, string>,
): string {
  const sourceName = nodeMap.get(edge.source_id) ?? edge.source_id;
  const targetName = nodeMap.get(edge.target_id) ?? edge.target_id;
  const weightStr = edge.weight !== 1 ? ` (weight: ${edge.weight})` : '';
  return `"${sourceName}" --[${edge.relation}]--> "${targetName}"${weightStr}`;
}

/**
 * Build structured context text from a subgraph centered on given node IDs.
 *
 * Fetches the subgraph for each seed node, merges results, and formats
 * into a text block suitable for LLM prompt injection.
 */
export async function buildContext(
  nodeIds: string[],
  userId: string,
  options: ContextOptions = {},
): Promise<ContextResult> {
  const maxTokens = options.maxTokens ?? 2000;
  const includeEdges = options.includeEdges ?? true;
  const includeProperties = options.includeProperties ?? true;
  const depth = options.depth ?? 2;

  // Merge subgraphs from all seed nodes
  const allNodes = new Map<string, SubgraphResult['nodes'][number]>();
  const allEdges = new Map<string, SubgraphResult['edges'][number]>();

  for (const nodeId of nodeIds) {
    const subgraph = await getSubgraph(nodeId, userId, depth);
    for (const node of subgraph.nodes) {
      allNodes.set(node.id, node);
    }
    for (const edge of subgraph.edges) {
      allEdges.set(edge.id, edge);
    }
  }

  const nodes = Array.from(allNodes.values());
  const edges = Array.from(allEdges.values());

  // Build node title lookup for edge formatting
  const nodeMap = new Map<string, string>();
  for (const node of nodes) {
    nodeMap.set(node.id, node.title);
  }

  // Format nodes and edges
  const nodeLines = nodes.map((n) => formatNode(n, includeProperties));
  const edgeLines = includeEdges
    ? edges.map((e) => formatEdge(e, nodeMap))
    : [];

  // Assemble context with token budget
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  const sections: string[] = [];
  let currentChars = 0;
  let truncated = false;
  let includedNodeCount = 0;
  let includedEdgeCount = 0;

  // Nodes section
  if (nodeLines.length > 0) {
    const header = '## Nodes\n';
    currentChars += header.length;
    const includedLines: string[] = [];

    for (const line of nodeLines) {
      const lineChars = line.length + 1; // +1 for newline
      if (currentChars + lineChars > maxChars) {
        truncated = true;
        break;
      }
      includedLines.push(line);
      currentChars += lineChars;
      includedNodeCount++;
    }

    if (includedLines.length > 0) {
      sections.push(header + includedLines.join('\n'));
    }
  }

  // Edges section
  if (includeEdges && edgeLines.length > 0 && !truncated) {
    const header = '\n## Relationships\n';
    currentChars += header.length;
    const includedLines: string[] = [];

    for (const line of edgeLines) {
      const lineChars = line.length + 1;
      if (currentChars + lineChars > maxChars) {
        truncated = true;
        break;
      }
      includedLines.push(line);
      currentChars += lineChars;
      includedEdgeCount++;
    }

    if (includedLines.length > 0) {
      sections.push(header + includedLines.join('\n'));
    }
  }

  const text = sections.join('\n');

  return {
    text,
    estimatedTokens: estimateTokens(text),
    truncated,
    nodeCount: includedNodeCount,
    edgeCount: includedEdgeCount,
  };
}

/**
 * Build context from a single node ID (convenience wrapper).
 */
export async function buildNodeContext(
  nodeId: string,
  userId: string,
  options: ContextOptions = {},
): Promise<ContextResult> {
  return buildContext([nodeId], userId, options);
}
