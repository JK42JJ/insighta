-- ============================================================================
-- Ontology Phase A.5: Row Level Security Policies
-- ============================================================================

-- ============================================================================
-- Enable RLS on all ontology tables
-- ============================================================================

ALTER TABLE ontology.nodes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ontology.edges ENABLE ROW LEVEL SECURITY;
ALTER TABLE ontology.action_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ontology.embeddings ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- User isolation policies (nodes, edges, action_log)
-- ============================================================================

CREATE POLICY user_isolation_nodes ON ontology.nodes
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY user_isolation_edges ON ontology.edges
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY user_isolation_action_log ON ontology.action_log
  FOR ALL USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Embeddings: access via node ownership (join through nodes)
CREATE POLICY user_isolation_embeddings ON ontology.embeddings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM ontology.nodes n
      WHERE n.id = ontology.embeddings.node_id
        AND n.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM ontology.nodes n
      WHERE n.id = ontology.embeddings.node_id
        AND n.user_id = auth.uid()
    )
  );

-- ============================================================================
-- Dictionary tables: authenticated read-only
-- ============================================================================

ALTER TABLE ontology.object_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE ontology.relation_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE ontology.action_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY read_only_object_types ON ontology.object_types
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY read_only_relation_types ON ontology.relation_types
  FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY read_only_action_types ON ontology.action_types
  FOR SELECT USING (auth.role() = 'authenticated');

-- ============================================================================
-- Service role bypass (for triggers and backend operations)
-- ============================================================================
-- Note: Supabase service_role bypasses RLS by default.
-- Backend uses prisma.$queryRaw which connects as postgres user (RLS bypassed).
-- These policies are for direct Supabase client access from frontend (future).
