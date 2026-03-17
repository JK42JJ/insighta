import { z } from 'zod';

// ============================================================================
// Ontology API — Zod Request/Response Schemas
// ============================================================================

// -- Request Schemas --

export const ListNodesQuerySchema = z.object({
  type: z.string().optional(),
  created_after: z.string().datetime().optional(),
  created_before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
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

export const EdgeIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const VectorSearchBodySchema = z.object({
  query_embedding: z.array(z.number()).min(1),
  limit: z.number().int().min(1).max(50).default(10),
  threshold: z.number().min(0).max(1).default(0.3),
  type_filter: z.string().optional(),
});

export const TextSearchQuerySchema = z.object({
  q: z.string().min(1),
  type: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// -- Type exports --

export type ListNodesQuery = z.infer<typeof ListNodesQuerySchema>;
export type CreateNodeBody = z.infer<typeof CreateNodeBodySchema>;
export type UpdateNodeBody = z.infer<typeof UpdateNodeBodySchema>;
export type CreateEdgeBody = z.infer<typeof CreateEdgeBodySchema>;
export type VectorSearchBody = z.infer<typeof VectorSearchBodySchema>;
export type TextSearchQuery = z.infer<typeof TextSearchQuerySchema>;
