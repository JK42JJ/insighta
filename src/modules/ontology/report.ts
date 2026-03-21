/**
 * Weekly Knowledge Summary — graph-based learning report generation
 *
 * Queries action_log + nodes/edges for temporal analysis,
 * uses ContextBuilder + LLM for narrative summary generation.
 * Issue: #254 (MA-2: GraphDB Service Layer)
 */

import { getPrismaClient } from '../database/client';
import { buildContext } from './context-builder';
import { createGenerationProvider } from '../llm';
import type { GenerationProvider } from '../llm';
import { logger } from '../../utils/logger';

// ============================================================================
// Types
// ============================================================================

type ReportPeriod = 'day' | 'week' | 'month';

interface PeriodStats {
  nodesAdded: number;
  nodesUpdated: number;
  edgesCreated: number;
  memosWritten: number;
  totalActions: number;
}

interface TopTopic {
  nodeId: string;
  title: string;
  edgeCount: number;
  actionCount: number;
  score: number;
}

interface NewConnection {
  edgeId: string;
  sourceTitle: string;
  targetTitle: string;
  relation: string;
  createdAt: string;
}

interface GraphGap {
  nodeId: string;
  title: string;
  reason: string;
}

export interface KnowledgeSummary {
  period: ReportPeriod;
  periodStart: string;
  periodEnd: string;
  stats: PeriodStats;
  topTopics: TopTopic[];
  newConnections: NewConnection[];
  summary: string;
  suggestions: string[];
}

// ============================================================================
// Constants
// ============================================================================

const PERIOD_INTERVALS: Record<ReportPeriod, string> = {
  day: '1 day',
  week: '7 days',
  month: '30 days',
};

const TOP_TOPICS_LIMIT = 5;
const NEW_CONNECTIONS_LIMIT = 10;
const MAX_CONTEXT_TOKENS = 1500;

// ============================================================================
// Report Pipeline
// ============================================================================

let generationProvider: GenerationProvider | null = null;

async function getProvider(): Promise<GenerationProvider> {
  if (!generationProvider) {
    generationProvider = await createGenerationProvider();
  }
  return generationProvider;
}

async function getPeriodStats(
  userId: string,
  interval: string,
): Promise<PeriodStats> {
  const prisma = getPrismaClient();

  const rows = await prisma.$queryRaw<
    { action: string; cnt: bigint }[]
  >`
    SELECT action, count(*) as cnt
    FROM ontology.action_log
    WHERE user_id = ${userId}::uuid
      AND created_at >= now() - ${interval}::interval
    GROUP BY action
  `;

  const counts: Record<string, number> = {};
  let totalActions = 0;
  for (const r of rows) {
    const n = Number(r.cnt);
    counts[r.action] = n;
    totalActions += n;
  }

  return {
    nodesAdded: counts['create_node'] || 0,
    nodesUpdated: counts['update_node'] || 0,
    edgesCreated: counts['create_edge'] || 0,
    memosWritten: counts['update_memo'] || counts['add_memo'] || 0,
    totalActions,
  };
}

async function getTopTopics(
  userId: string,
  interval: string,
): Promise<TopTopic[]> {
  const prisma = getPrismaClient();

  return prisma.$queryRaw<TopTopic[]>`
    WITH edge_counts AS (
      SELECT n.id, n.title, count(e.id) as edge_count
      FROM ontology.nodes n
      LEFT JOIN ontology.edges e ON (e.source_id = n.id OR e.target_id = n.id)
      WHERE n.user_id = ${userId}::uuid
        AND n.domain = 'service'
      GROUP BY n.id, n.title
    ),
    action_counts AS (
      SELECT entity_id, count(*) as action_count
      FROM ontology.action_log
      WHERE user_id = ${userId}::uuid
        AND created_at >= now() - ${interval}::interval
      GROUP BY entity_id
    )
    SELECT
      ec.id as "nodeId",
      ec.title,
      ec.edge_count::int as "edgeCount",
      COALESCE(ac.action_count, 0)::int as "actionCount",
      (ec.edge_count * 2 + COALESCE(ac.action_count, 0) * 3)::int as score
    FROM edge_counts ec
    LEFT JOIN action_counts ac ON ac.entity_id = ec.id
    ORDER BY score DESC
    LIMIT ${TOP_TOPICS_LIMIT}
  `;
}

async function getNewConnections(
  userId: string,
  interval: string,
): Promise<NewConnection[]> {
  const prisma = getPrismaClient();

  return prisma.$queryRaw<NewConnection[]>`
    SELECT
      e.id as "edgeId",
      src.title as "sourceTitle",
      tgt.title as "targetTitle",
      e.relation,
      e.created_at::text as "createdAt"
    FROM ontology.edges e
    JOIN ontology.nodes src ON src.id = e.source_id
    JOIN ontology.nodes tgt ON tgt.id = e.target_id
    WHERE src.user_id = ${userId}::uuid
      AND e.created_at >= now() - ${interval}::interval
    ORDER BY e.created_at DESC
    LIMIT ${NEW_CONNECTIONS_LIMIT}
  `;
}

async function getGraphGaps(userId: string): Promise<GraphGap[]> {
  const prisma = getPrismaClient();

  // Find isolated nodes (no edges) in service domain
  return prisma.$queryRaw<GraphGap[]>`
    SELECT n.id as "nodeId", n.title, 'isolated node — no connections' as reason
    FROM ontology.nodes n
    LEFT JOIN ontology.edges e ON (e.source_id = n.id OR e.target_id = n.id)
    WHERE n.user_id = ${userId}::uuid
      AND n.domain = 'service'
      AND e.id IS NULL
    ORDER BY n.created_at DESC
    LIMIT 5
  `;
}

function buildReportPrompt(
  stats: PeriodStats,
  topTopics: TopTopic[],
  newConnections: NewConnection[],
  gaps: GraphGap[],
  graphContext: string,
  period: ReportPeriod,
): string {
  const topicsBlock = topTopics.length > 0
    ? topTopics.map((t) => `- ${t.title} (connections: ${t.edgeCount}, actions: ${t.actionCount})`).join('\n')
    : '- No active topics this period';

  const connectionsBlock = newConnections.length > 0
    ? newConnections.map((c) => `- ${c.sourceTitle} → ${c.targetTitle} (${c.relation})`).join('\n')
    : '- No new connections this period';

  const gapsBlock = gaps.length > 0
    ? gaps.map((g) => `- ${g.title}: ${g.reason}`).join('\n')
    : '- No gaps detected';

  return `Generate a knowledge learning summary report for the past ${period}.

## Activity Stats
- Nodes added: ${stats.nodesAdded}
- Nodes updated: ${stats.nodesUpdated}
- Edges created: ${stats.edgesCreated}
- Memos written: ${stats.memosWritten}
- Total actions: ${stats.totalActions}

## Top Topics
${topicsBlock}

## New Connections
${connectionsBlock}

## Knowledge Gaps
${gapsBlock}

${graphContext ? `## Knowledge Graph Context\n${graphContext}\n` : ''}
## Instructions
- Write a 2-3 paragraph summary of the user's learning progress this ${period}.
- Highlight key insights and patterns in their learning.
- Be encouraging but specific — reference actual topics and connections.
- Respond in Korean if most topic titles are Korean, otherwise English.
- End with 2-3 actionable suggestions for next ${period} based on gaps and patterns.
- Format suggestions as a bulleted list prefixed with "Suggestion:".`;
}

function extractSuggestions(text: string): { summary: string; suggestions: string[] } {
  const lines = text.split('\n');
  const suggestions: string[] = [];
  const summaryLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('Suggestion:') || trimmed.startsWith('- Suggestion:')) {
      suggestions.push(trimmed.replace(/^-?\s*Suggestion:\s*/i, '').trim());
    } else {
      summaryLines.push(line);
    }
  }

  return {
    summary: summaryLines.join('\n').trim(),
    suggestions,
  };
}

export async function generateKnowledgeSummary(
  userId: string,
  period: ReportPeriod = 'week',
): Promise<KnowledgeSummary> {
  const interval = PERIOD_INTERVALS[period];
  const now = new Date();
  const periodMs = period === 'day' ? 86400000 : period === 'week' ? 604800000 : 2592000000;
  const periodStart = new Date(now.getTime() - periodMs);

  logger.info('Generating knowledge summary', { userId, period });

  // 1. Gather stats in parallel
  const [stats, topTopics, newConnections, gaps] = await Promise.all([
    getPeriodStats(userId, interval),
    getTopTopics(userId, interval),
    getNewConnections(userId, interval),
    getGraphGaps(userId),
  ]);

  // 2. Build graph context from top topics
  let graphContext = '';
  if (topTopics.length > 0) {
    try {
      const topNodeIds = topTopics.map((t) => t.nodeId);
      const ctx = await buildContext(topNodeIds, userId, {
        maxTokens: MAX_CONTEXT_TOKENS,
        includeEdges: true,
        includeProperties: true,
      });
      graphContext = ctx.text;
    } catch {
      // Non-fatal
    }
  }

  // 3. Generate LLM summary
  let summary = '';
  let suggestions: string[] = [];

  if (stats.totalActions > 0 || topTopics.length > 0) {
    try {
      const provider = await getProvider();
      const prompt = buildReportPrompt(stats, topTopics, newConnections, gaps, graphContext, period);
      const raw = await provider.generate(prompt, { temperature: 0.7 });
      const parsed = extractSuggestions(raw);
      summary = parsed.summary;
      suggestions = parsed.suggestions;
    } catch (err) {
      logger.warn('LLM summary generation failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      summary = `This ${period} you added ${stats.nodesAdded} nodes, created ${stats.edgesCreated} connections, and performed ${stats.totalActions} total actions.`;
    }
  } else {
    summary = `No activity recorded for this ${period}. Start by adding resources to your knowledge graph.`;
  }

  // 4. Add gap-based suggestions if LLM didn't generate enough
  if (suggestions.length === 0 && gaps.length > 0) {
    suggestions = gaps.slice(0, 3).map((g) => `Connect "${g.title}" to related topics to strengthen your knowledge graph.`);
  }

  logger.info('Knowledge summary generated', {
    userId,
    period,
    stats,
    topTopicsCount: topTopics.length,
    suggestionsCount: suggestions.length,
  });

  return {
    period,
    periodStart: periodStart.toISOString(),
    periodEnd: now.toISOString(),
    stats,
    topTopics,
    newConnections,
    summary,
    suggestions,
  };
}
