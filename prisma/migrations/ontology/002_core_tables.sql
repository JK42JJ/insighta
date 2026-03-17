-- ============================================================================
-- Ontology Phase A.2: Core Tables (nodes, edges, action_log, embeddings)
-- ============================================================================
-- ADR-2: Materialize-on-Reference — shadow nodes in ontology.nodes
-- ADR-3: Raw SQL via prisma.$queryRaw (no Prisma models for ontology)
-- ADR-4: Gemini text-embedding-004 (768d) for embeddings
-- ============================================================================

-- pgvector extension (required for embeddings)
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================================
-- ontology.nodes
-- ============================================================================

CREATE TABLE ontology.nodes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  type        TEXT NOT NULL REFERENCES ontology.object_types(code),
  title       TEXT NOT NULL,
  properties  JSONB NOT NULL DEFAULT '{}',
  source_ref  JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for nodes
CREATE INDEX idx_ont_nodes_user_type ON ontology.nodes (user_id, type);
CREATE INDEX idx_ont_nodes_created ON ontology.nodes (created_at DESC);
CREATE INDEX idx_ont_nodes_updated ON ontology.nodes (updated_at DESC);
CREATE INDEX idx_ont_nodes_properties ON ontology.nodes USING GIN (properties);
CREATE INDEX idx_ont_nodes_source_ref ON ontology.nodes USING GIN (source_ref);
CREATE INDEX idx_ont_nodes_title_fts ON ontology.nodes USING GIN (to_tsvector('english', title));

-- Unique constraint: one shadow node per public schema entity
CREATE UNIQUE INDEX idx_ont_nodes_source_ref_unique
  ON ontology.nodes ((source_ref->>'table'), (source_ref->>'id'))
  WHERE source_ref IS NOT NULL;

-- ============================================================================
-- ontology.edges
-- ============================================================================

CREATE TABLE ontology.edges (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  source_id   UUID NOT NULL REFERENCES ontology.nodes(id) ON DELETE CASCADE,
  target_id   UUID NOT NULL REFERENCES ontology.nodes(id) ON DELETE CASCADE,
  relation    TEXT NOT NULL REFERENCES ontology.relation_types(code),
  weight      FLOAT NOT NULL DEFAULT 1.0,
  properties  JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT no_self_edge CHECK (source_id != target_id),
  CONSTRAINT unique_edge UNIQUE (source_id, target_id, relation)
);

-- Indexes for edges
CREATE INDEX idx_ont_edges_source ON ontology.edges (source_id);
CREATE INDEX idx_ont_edges_target ON ontology.edges (target_id);
CREATE INDEX idx_ont_edges_relation ON ontology.edges (relation);
CREATE INDEX idx_ont_edges_user ON ontology.edges (user_id);

-- ============================================================================
-- ontology.action_log (append-only audit trail)
-- ============================================================================

CREATE TABLE ontology.action_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL,
  action      TEXT NOT NULL REFERENCES ontology.action_types(code),
  entity_type TEXT NOT NULL,
  entity_id   UUID NOT NULL,
  before_data JSONB,
  after_data  JSONB,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for action_log
CREATE INDEX idx_ont_action_log_entity ON ontology.action_log (entity_type, entity_id);
CREATE INDEX idx_ont_action_log_entity_time ON ontology.action_log (entity_id, created_at DESC);
CREATE INDEX idx_ont_action_log_user_time ON ontology.action_log (user_id, created_at DESC);
CREATE INDEX idx_ont_action_log_action ON ontology.action_log (action);

-- ============================================================================
-- ontology.embeddings (pgvector)
-- ============================================================================

CREATE TABLE ontology.embeddings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  node_id     UUID NOT NULL REFERENCES ontology.nodes(id) ON DELETE CASCADE,
  model       TEXT NOT NULL DEFAULT 'text-embedding-004',
  embedding   vector(768) NOT NULL,
  text_hash   TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT unique_node_model UNIQUE (node_id, model)
);

-- IVFFlat index for cosine similarity (requires rows to exist for training)
-- Will be created after initial data load via backfill script
-- CREATE INDEX idx_ont_embeddings_cosine ON ontology.embeddings
--   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 50);
