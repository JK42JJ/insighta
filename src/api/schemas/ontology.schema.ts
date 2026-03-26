import { z } from 'zod';

// ============================================================================
// Ontology API — Zod Request/Response Schemas
// ============================================================================

// -- Request Schemas --

export const NodeIdParamsSchema = z.object({
  id: z.string().uuid('Invalid node/edge ID format'),
});

export const DomainEnum = z.enum(['service', 'system']);

export const ListNodesQuerySchema = z.object({
  domain: DomainEnum.optional(),
  type: z.string().optional(),
  created_after: z.string().datetime().optional(),
  created_before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export const CreateNodeBodySchema = z.object({
  type: z.string().min(1),
  title: z.string().min(1).max(500),
  properties: z.record(z.unknown()).default({}),
  source_ref: z
    .object({
      table: z.string(),
      id: z.string(),
    })
    .nullable()
    .optional(),
});

export const UpdateNodeBodySchema = z.object({
  title: z.string().min(1).max(500).optional(),
  properties: z.record(z.unknown()).optional(),
});

export const NodeIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const NeighborsQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(5).default(1),
  relation: z.string().optional(),
});

export const HistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const CreateEdgeBodySchema = z.object({
  source_id: z.string().uuid(),
  target_id: z.string().uuid(),
  relation: z.string().min(1),
  weight: z.number().min(0).max(10).default(1.0),
  properties: z.record(z.unknown()).default({}),
});

export const ListEdgesQuerySchema = z.object({
  relation: z.string().optional(),
  domain: DomainEnum.optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

export const EdgeIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const VectorSearchBodySchema = z.object({
  query_embedding: z.array(z.number()).min(1),
  limit: z.number().int().min(1).max(50).default(10),
  threshold: z.number().min(0).max(1).default(0.3),
  type_filter: z.string().optional(),
  domain: DomainEnum.optional(),
});

export const TextSearchQuerySchema = z.object({
  q: z.string().min(1),
  type: z.string().optional(),
  domain: DomainEnum.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const SemanticSearchBodySchema = z.object({
  query: z.string().min(1).max(2000),
  limit: z.number().int().min(1).max(50).default(10),
  threshold: z.number().min(0).max(1).default(0.3),
  type_filter: z.string().optional(),
  domain: DomainEnum.optional(),
});

export const EnrichBodySchema = z.object({
  node_id: z.string().uuid(),
});

export const BatchEnrichBodySchema = z.object({
  limit: z.number().int().min(0).max(500).default(10),
  delay_ms: z.number().int().min(0).max(10000).default(2000),
});

export const AutoEnrichBodySchema = z.object({
  source_table: z.string().min(1),
  source_id: z.string().min(1),
  force: z.boolean().optional(),
  transcript: z.string().min(10).optional(),
});

export const RateSummaryBodySchema = z.object({
  card_id: z.string().uuid(),
  rating: z.union([z.literal(1), z.literal(-1)]).nullable(),
});

// -- Type exports --

export type ListNodesQuery = z.infer<typeof ListNodesQuerySchema>;
export type CreateNodeBody = z.infer<typeof CreateNodeBodySchema>;
export type UpdateNodeBody = z.infer<typeof UpdateNodeBodySchema>;
export type CreateEdgeBody = z.infer<typeof CreateEdgeBodySchema>;
export type VectorSearchBody = z.infer<typeof VectorSearchBodySchema>;
export type ListEdgesQuery = z.infer<typeof ListEdgesQuerySchema>;
export type TextSearchQuery = z.infer<typeof TextSearchQuerySchema>;
export type SemanticSearchBody = z.infer<typeof SemanticSearchBodySchema>;

// -- Chat Schemas --

export const ChatBodySchema = z.object({
  query: z.string().min(1).max(2000),
  conversationId: z.string().uuid().optional(),
});

export type ChatBody = z.infer<typeof ChatBodySchema>;

// -- Summary Report Schemas --

export const SummaryQuerySchema = z.object({
  period: z.enum(['day', 'week', 'month']).default('week'),
});

export type SummaryQuery = z.infer<typeof SummaryQuerySchema>;

// -- Router Schemas --

export const RouteBodySchema = z.object({
  query: z.string().min(1).max(2000),
  conversationId: z.string().uuid().optional(),
});

export type RouteBody = z.infer<typeof RouteBodySchema>;
