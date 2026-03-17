#!/usr/bin/env node

/**
 * Insighta Ontology MCP Server
 *
 * Provides Claude Code with direct access to the ontology knowledge graph.
 * Tools: context_for_task, similar_problems, graph_neighbors, recent_nodes, graph_stats
 *
 * Issue: #169 (M12: Intelligence Pipeline)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

import { initDb, closePool } from './db.js';
import {
  contextForTask,
  similarProblems,
  graphNeighbors,
  recentNodes,
  graphStats,
} from './tools.js';

// Load .env from project root
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env'), override: true });

const server = new McpServer({
  name: 'insighta-ontology',
  version: '1.0.0',
});

// ============================================================================
// Tool: context_for_task
// ============================================================================

server.tool(
  'context_for_task',
  'Search ontology knowledge graph for context relevant to a task. Returns nodes ranked by semantic similarity.',
  {
    task_description: z.string().describe('Description of the task to find context for'),
    limit: z.number().int().min(1).max(50).default(10).describe('Max results'),
  },
  async ({ task_description, limit }) => {
    const result = await contextForTask(task_description, limit);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

// ============================================================================
// Tool: similar_problems
// ============================================================================

server.tool(
  'similar_problems',
  'Find similar past problems and patterns from the ontology. Useful for debugging and troubleshooting.',
  {
    problem_description: z.string().describe('Description of the problem to find similar cases for'),
    limit: z.number().int().min(1).max(20).default(5).describe('Max results'),
  },
  async ({ problem_description, limit }) => {
    const results = await similarProblems(problem_description, limit);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(results, null, 2),
      }],
    };
  }
);

// ============================================================================
// Tool: graph_neighbors
// ============================================================================

server.tool(
  'graph_neighbors',
  'Traverse the ontology graph from a node. Returns connected nodes via edges (CONTAINS, PLACED_IN, DERIVED_FROM, etc).',
  {
    node_id: z.string().uuid().describe('UUID of the starting node'),
    depth: z.number().int().min(1).max(5).default(1).describe('Traversal depth'),
    relation: z.string().optional().describe('Filter by relation type (e.g., CONTAINS, PLACED_IN)'),
  },
  async ({ node_id, depth, relation }) => {
    const neighbors = await graphNeighbors(node_id, depth, relation);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(neighbors, null, 2),
      }],
    };
  }
);

// ============================================================================
// Tool: recent_nodes
// ============================================================================

server.tool(
  'recent_nodes',
  'List recently created ontology nodes. Filter by type (resource, problem, decision, pattern, etc).',
  {
    days: z.number().int().min(1).max(365).default(7).describe('Look back N days'),
    type: z.string().optional().describe('Filter by node type'),
    limit: z.number().int().min(1).max(100).default(20).describe('Max results'),
  },
  async ({ days, type, limit }) => {
    const nodes = await recentNodes(days, type, limit);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(nodes, null, 2),
      }],
    };
  }
);

// ============================================================================
// Tool: graph_stats
// ============================================================================

server.tool(
  'graph_stats',
  'Get ontology knowledge graph statistics: node/edge counts by type, embedding coverage.',
  {},
  async () => {
    const stats = await graphStats();
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify(stats, null, 2),
      }],
    };
  }
);

// ============================================================================
// Server lifecycle
// ============================================================================

async function main() {
  await initDb();

  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on('SIGINT', async () => {
    await closePool();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('MCP server error:', err);
  process.exit(1);
});
