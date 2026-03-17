-- ============================================================================
-- Ontology Phase B.3: Graph Functions + Backfill Script
-- ============================================================================

-- ============================================================================
-- get_neighbors(): recursive CTE with cycle detection
-- ============================================================================

CREATE OR REPLACE FUNCTION ontology.get_neighbors(
  p_node_id UUID,
  p_user_id UUID,
  p_relation TEXT DEFAULT NULL,
  p_depth INT DEFAULT 1
)
RETURNS TABLE (
  node_id UUID,
  node_type TEXT,
  title TEXT,
  properties JSONB,
  relation TEXT,
  direction TEXT,
  depth INT
)
LANGUAGE SQL STABLE
AS $$
  WITH RECURSIVE neighbors AS (
    -- Base case: direct neighbors (outgoing)
    SELECT
      n.id AS node_id,
      n.type AS node_type,
      n.title,
      n.properties,
      e.relation,
      'outgoing'::TEXT AS direction,
      1 AS depth
    FROM ontology.edges e
    JOIN ontology.nodes n ON n.id = e.target_id
    WHERE e.source_id = p_node_id
      AND e.user_id = p_user_id
      AND (p_relation IS NULL OR e.relation = p_relation)

    UNION ALL

    -- Base case: direct neighbors (incoming)
    SELECT
      n.id AS node_id,
      n.type AS node_type,
      n.title,
      n.properties,
      e.relation,
      'incoming'::TEXT AS direction,
      1 AS depth
    FROM ontology.edges e
    JOIN ontology.nodes n ON n.id = e.source_id
    WHERE e.target_id = p_node_id
      AND e.user_id = p_user_id
      AND (p_relation IS NULL OR e.relation = p_relation)

    UNION ALL

    -- Recursive: deeper neighbors (outgoing only to avoid infinite loops)
    SELECT
      n.id,
      n.type,
      n.title,
      n.properties,
      e.relation,
      'outgoing'::TEXT,
      nb.depth + 1
    FROM neighbors nb
    JOIN ontology.edges e ON e.source_id = nb.node_id
    JOIN ontology.nodes n ON n.id = e.target_id
    WHERE nb.depth < p_depth
      AND e.user_id = p_user_id
      AND (p_relation IS NULL OR e.relation = p_relation)
      AND n.id != p_node_id  -- cycle detection
  )
  SELECT DISTINCT ON (neighbors.node_id)
    neighbors.node_id,
    neighbors.node_type,
    neighbors.title,
    neighbors.properties,
    neighbors.relation,
    neighbors.direction,
    neighbors.depth
  FROM neighbors
  ORDER BY neighbors.node_id, neighbors.depth ASC;
$$;

-- ============================================================================
-- backfill_shadow_nodes(): one-time migration of existing data
-- ============================================================================

CREATE OR REPLACE FUNCTION ontology.backfill_shadow_nodes()
RETURNS TABLE (source_table TEXT, synced_count BIGINT)
LANGUAGE plpgsql
AS $$
BEGIN
  -- Backfill user_local_cards → resource nodes
  INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref)
  SELECT
    c.user_id,
    'resource',
    COALESCE(c.title, c.metadata_title, c.url),
    jsonb_build_object(
      'url', c.url,
      'link_type', c.link_type,
      'thumbnail', COALESCE(c.thumbnail, c.metadata_image),
      'user_note', c.user_note
    ),
    jsonb_build_object('table', 'user_local_cards', 'id', c.id::text)
  FROM public.user_local_cards c
  ON CONFLICT ((source_ref->>'table'), (source_ref->>'id')) WHERE source_ref IS NOT NULL DO NOTHING;

  source_table := 'user_local_cards';
  synced_count := (SELECT count(*) FROM ontology.nodes WHERE source_ref->>'table' = 'user_local_cards');
  RETURN NEXT;

  -- Backfill user_mandalas → mandala nodes
  INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref)
  SELECT
    m.user_id,
    'mandala',
    m.title,
    jsonb_build_object('is_default', m.is_default, 'position', m.position),
    jsonb_build_object('table', 'user_mandalas', 'id', m.id::text)
  FROM public.user_mandalas m
  ON CONFLICT ((source_ref->>'table'), (source_ref->>'id')) WHERE source_ref IS NOT NULL DO NOTHING;

  source_table := 'user_mandalas';
  synced_count := (SELECT count(*) FROM ontology.nodes WHERE source_ref->>'table' = 'user_mandalas');
  RETURN NEXT;

  -- Backfill user_mandala_levels → mandala_sector nodes
  INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref)
  SELECT
    m.user_id,
    'mandala_sector',
    COALESCE(NULLIF(l.center_goal, ''), l.level_key),
    jsonb_build_object(
      'level_key', l.level_key,
      'center_goal', l.center_goal,
      'subjects', to_jsonb(l.subjects),
      'position', l.position,
      'depth', l.depth
    ),
    jsonb_build_object('table', 'user_mandala_levels', 'id', l.id::text)
  FROM public.user_mandala_levels l
  JOIN public.user_mandalas m ON m.id = l.mandala_id
  ON CONFLICT ((source_ref->>'table'), (source_ref->>'id')) WHERE source_ref IS NOT NULL DO NOTHING;

  source_table := 'user_mandala_levels';
  synced_count := (SELECT count(*) FROM ontology.nodes WHERE source_ref->>'table' = 'user_mandala_levels');
  RETURN NEXT;
END;
$$;
