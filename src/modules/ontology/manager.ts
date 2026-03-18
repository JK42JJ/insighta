import { PrismaClient, Prisma } from '@prisma/client';
import { getPrismaClient } from '../database/client';
import { validateProperties } from './schemas';

// ============================================================================
// Ontology Manager — CRUD + ActionLog
// ADR-3: Raw SQL via prisma.$queryRaw
// ============================================================================

export interface OntologyNode {
  id: string;
  user_id: string;
  type: string;
  title: string;
  properties: Record<string, unknown>;
  source_ref: { table: string; id: string } | null;
  created_at: Date;
  updated_at: Date;
}

export interface OntologyEdge {
  id: string;
  user_id: string;
  source_id: string;
  target_id: string;
  relation: string;
  weight: number;
  properties: Record<string, unknown>;
  created_at: Date;
}

export interface CreateNodeInput {
  type: string;
  title: string;
  properties?: Record<string, unknown>;
  source_ref?: { table: string; id: string } | null;
}

export interface UpdateNodeInput {
  title?: string;
  properties?: Record<string, unknown>;
}

export interface CreateEdgeInput {
  source_id: string;
  target_id: string;
  relation: string;
  weight?: number;
  properties?: Record<string, unknown>;
}

export interface ListNodesFilter {
  domain?: 'service' | 'system';
  type?: string;
  created_after?: string;
  created_before?: string;
  limit?: number;
  offset?: number;
}

export interface ListEdgesFilter {
  relation?: string;
  domain?: 'service' | 'system';
  limit?: number;
  offset?: number;
}

class OntologyManager {
  private prisma: PrismaClient;

  constructor() {
    this.prisma = getPrismaClient();
  }

  // ==========================================================================
  // ActionLog helper
  // ==========================================================================

  private async logAction(
    userId: string,
    action: string,
    entityType: string,
    entityId: string,
    beforeData: unknown | null,
    afterData: unknown | null,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    await this.prisma.$executeRaw`
      INSERT INTO ontology.action_log (user_id, action, entity_type, entity_id, before_data, after_data, metadata)
      VALUES (
        ${userId}::uuid,
        ${action},
        ${entityType},
        ${entityId}::uuid,
        ${beforeData ? JSON.stringify(beforeData) : null}::jsonb,
        ${afterData ? JSON.stringify(afterData) : null}::jsonb,
        ${JSON.stringify(metadata)}::jsonb
      )
    `;
  }

  // ==========================================================================
  // Node CRUD
  // ==========================================================================

  async listNodes(
    userId: string,
    filter: ListNodesFilter = {}
  ): Promise<{ nodes: OntologyNode[]; total: number }> {
    const limit = Math.min(filter.limit ?? 50, 1000);
    const offset = filter.offset ?? 0;

    const conditions: Prisma.Sql[] = [Prisma.sql`n.user_id = ${userId}::uuid`];

    if (filter.type) {
      conditions.push(Prisma.sql`n.type = ${filter.type}`);
    }
    if (filter.created_after) {
      conditions.push(Prisma.sql`n.created_at >= ${filter.created_after}::timestamptz`);
    }
    if (filter.created_before) {
      conditions.push(Prisma.sql`n.created_at <= ${filter.created_before}::timestamptz`);
    }
    if (filter.domain) {
      conditions.push(Prisma.sql`ot.domain = ${filter.domain}`);
    }

    const where = Prisma.join(conditions, ' AND ');
    const needsJoin = !!filter.domain;

    const fromClause = needsJoin
      ? Prisma.sql`ontology.nodes n JOIN ontology.object_types ot ON n.type = ot.code`
      : Prisma.sql`ontology.nodes n`;

    const nodes = await this.prisma.$queryRaw<OntologyNode[]>`
      SELECT n.id, n.user_id, n.type, n.title, n.properties, n.source_ref, n.created_at, n.updated_at
      FROM ${fromClause}
      WHERE ${where}
      ORDER BY n.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countResult = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT count(*) FROM ${fromClause} WHERE ${where}
    `;
    const total = Number(countResult[0]?.count ?? 0);

    return { nodes, total };
  }

  async getNode(userId: string, nodeId: string): Promise<OntologyNode | null> {
    const rows = await this.prisma.$queryRaw<OntologyNode[]>`
      SELECT id, user_id, type, title, properties, source_ref, created_at, updated_at
      FROM ontology.nodes
      WHERE id = ${nodeId}::uuid AND user_id = ${userId}::uuid
    `;
    return rows[0] ?? null;
  }

  async createNode(userId: string, input: CreateNodeInput): Promise<OntologyNode> {
    const props = input.properties ?? {};
    const validation = validateProperties(input.type, props);
    if (!validation.success) {
      throw new Error(
        `Invalid properties for type '${input.type}': ${JSON.stringify(validation.error.issues)}`
      );
    }

    const sourceRefJson = input.source_ref ? JSON.stringify(input.source_ref) : null;

    const rows = await this.prisma.$queryRaw<OntologyNode[]>`
      INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref)
      VALUES (
        ${userId}::uuid,
        ${input.type},
        ${input.title},
        ${JSON.stringify(props)}::jsonb,
        ${sourceRefJson}::jsonb
      )
      RETURNING id, user_id, type, title, properties, source_ref, created_at, updated_at
    `;

    const node = rows[0]!;
    await this.logAction(userId, 'CREATE_NODE', 'node', node.id, null, node);
    return node;
  }

  async updateNode(userId: string, nodeId: string, input: UpdateNodeInput): Promise<OntologyNode> {
    const existing = await this.getNode(userId, nodeId);
    if (!existing) {
      throw new Error('NODE_NOT_FOUND');
    }

    const newTitle = input.title ?? existing.title;
    const newProps = input.properties ?? existing.properties;

    if (input.properties) {
      const validation = validateProperties(existing.type, newProps);
      if (!validation.success) {
        throw new Error(
          `Invalid properties for type '${existing.type}': ${JSON.stringify(validation.error.issues)}`
        );
      }
    }

    const rows = await this.prisma.$queryRaw<OntologyNode[]>`
      UPDATE ontology.nodes
      SET title = ${newTitle},
          properties = ${JSON.stringify(newProps)}::jsonb,
          updated_at = now()
      WHERE id = ${nodeId}::uuid AND user_id = ${userId}::uuid
      RETURNING id, user_id, type, title, properties, source_ref, created_at, updated_at
    `;

    const node = rows[0]!;
    await this.logAction(userId, 'UPDATE_NODE', 'node', nodeId, existing, node);
    return node;
  }

  async deleteNode(userId: string, nodeId: string): Promise<void> {
    const existing = await this.getNode(userId, nodeId);
    if (!existing) {
      throw new Error('NODE_NOT_FOUND');
    }

    await this.prisma.$executeRaw`
      DELETE FROM ontology.nodes WHERE id = ${nodeId}::uuid AND user_id = ${userId}::uuid
    `;

    await this.logAction(userId, 'DELETE_NODE', 'node', nodeId, existing, null);
  }

  // ==========================================================================
  // Edge CRUD
  // ==========================================================================

  async createEdge(userId: string, input: CreateEdgeInput): Promise<OntologyEdge> {
    const weight = input.weight ?? 1.0;
    const props = input.properties ?? {};

    // Cross-domain validation: prevent edges between service and system nodes
    const domainCheck = await this.prisma.$queryRaw<
      { source_domain: string; target_domain: string }[]
    >`
      SELECT
        (SELECT ot.domain FROM ontology.object_types ot WHERE ot.code = s.type) AS source_domain,
        (SELECT ot.domain FROM ontology.object_types ot WHERE ot.code = t.type) AS target_domain
      FROM ontology.nodes s, ontology.nodes t
      WHERE s.id = ${input.source_id}::uuid AND s.user_id = ${userId}::uuid
        AND t.id = ${input.target_id}::uuid AND t.user_id = ${userId}::uuid
    `;

    if (domainCheck.length > 0) {
      const { source_domain, target_domain } = domainCheck[0]!;
      if (
        source_domain &&
        target_domain &&
        source_domain !== 'shared' &&
        target_domain !== 'shared' &&
        source_domain !== target_domain
      ) {
        throw new Error('CROSS_DOMAIN_EDGE');
      }
    }

    const rows = await this.prisma.$queryRaw<OntologyEdge[]>`
      INSERT INTO ontology.edges (user_id, source_id, target_id, relation, weight, properties)
      VALUES (
        ${userId}::uuid,
        ${input.source_id}::uuid,
        ${input.target_id}::uuid,
        ${input.relation},
        ${weight},
        ${JSON.stringify(props)}::jsonb
      )
      RETURNING id, user_id, source_id, target_id, relation, weight, properties, created_at
    `;

    const edge = rows[0]!;
    await this.logAction(userId, 'ADD_EDGE', 'edge', edge.id, null, edge);
    return edge;
  }

  async listEdges(
    userId: string,
    filter: ListEdgesFilter = {}
  ): Promise<{ edges: OntologyEdge[]; total: number }> {
    const limit = Math.min(filter.limit ?? 200, 1000);
    const offset = filter.offset ?? 0;

    const conditions: Prisma.Sql[] = [Prisma.sql`e.user_id = ${userId}::uuid`];

    if (filter.relation) {
      conditions.push(Prisma.sql`e.relation = ${filter.relation}`);
    }

    if (filter.domain) {
      conditions.push(Prisma.sql`
        e.source_id IN (SELECT n.id FROM ontology.nodes n JOIN ontology.object_types ot ON n.type = ot.code WHERE ot.domain = ${filter.domain})
        AND e.target_id IN (SELECT n.id FROM ontology.nodes n JOIN ontology.object_types ot ON n.type = ot.code WHERE ot.domain = ${filter.domain})
      `);
    }

    const where = Prisma.join(conditions, ' AND ');

    const edges = await this.prisma.$queryRaw<OntologyEdge[]>`
      SELECT e.id, e.user_id, e.source_id, e.target_id, e.relation, e.weight, e.properties, e.created_at
      FROM ontology.edges e
      WHERE ${where}
      ORDER BY e.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const countResult = await this.prisma.$queryRaw<[{ count: bigint }]>`
      SELECT count(*) FROM ontology.edges e WHERE ${where}
    `;
    const total = Number(countResult[0]?.count ?? 0);

    return { edges, total };
  }

  async deleteEdge(userId: string, edgeId: string): Promise<void> {
    const existing = await this.prisma.$queryRaw<OntologyEdge[]>`
      SELECT id, user_id, source_id, target_id, relation, weight, properties, created_at
      FROM ontology.edges
      WHERE id = ${edgeId}::uuid AND user_id = ${userId}::uuid
    `;

    if (existing.length === 0) {
      throw new Error('EDGE_NOT_FOUND');
    }

    await this.prisma.$executeRaw`
      DELETE FROM ontology.edges WHERE id = ${edgeId}::uuid AND user_id = ${userId}::uuid
    `;

    await this.logAction(userId, 'REMOVE_EDGE', 'edge', edgeId, existing[0], null);
  }

  // ==========================================================================
  // History (action_log)
  // ==========================================================================

  async getNodeHistory(userId: string, nodeId: string, limit: number = 50): Promise<unknown[]> {
    return this.prisma.$queryRaw`
      SELECT id, action, entity_type, entity_id, before_data, after_data, metadata, created_at
      FROM ontology.action_log
      WHERE entity_id = ${nodeId}::uuid AND user_id = ${userId}::uuid
      ORDER BY created_at DESC
      LIMIT ${Math.min(limit, 100)}
    `;
  }

  // ==========================================================================
  // Stats
  // ==========================================================================

  async getStats(userId: string): Promise<{
    nodes_by_type: { type: string; count: number }[];
    edges_by_relation: { relation: string; count: number }[];
    total_nodes: number;
    total_edges: number;
  }> {
    const nodesByType = await this.prisma.$queryRaw<{ type: string; count: bigint }[]>`
      SELECT type, count(*) FROM ontology.nodes WHERE user_id = ${userId}::uuid GROUP BY type ORDER BY count DESC
    `;

    const edgesByRelation = await this.prisma.$queryRaw<{ relation: string; count: bigint }[]>`
      SELECT relation, count(*) FROM ontology.edges WHERE user_id = ${userId}::uuid GROUP BY relation ORDER BY count DESC
    `;

    return {
      nodes_by_type: nodesByType.map((r) => ({ type: r.type, count: Number(r.count) })),
      edges_by_relation: edgesByRelation.map((r) => ({
        relation: r.relation,
        count: Number(r.count),
      })),
      total_nodes: nodesByType.reduce((sum, r) => sum + Number(r.count), 0),
      total_edges: edgesByRelation.reduce((sum, r) => sum + Number(r.count), 0),
    };
  }
}

// Singleton
let instance: OntologyManager | null = null;
export function getOntologyManager(): OntologyManager {
  if (!instance) {
    instance = new OntologyManager();
  }
  return instance;
}

export { OntologyManager };
