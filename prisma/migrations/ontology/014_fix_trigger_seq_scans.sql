-- CP427: Fix Seq Scan in ontology trigger functions
-- All triggers used `source_ref = jsonb_build_object(...)` which causes Seq Scan (5.4ms/query).
-- Changed to `source_ref->>'table' = ... AND source_ref->>'id' = ...` which uses
-- idx_ont_nodes_source_ref_unique btree index (1.2ms/query, 4.5x improvement).
-- 9 levels × 6 triggers × ~15 lookups = ~117 queries affected per mandala creation.

BEGIN;

-- 1. create_structural_edges_for_level (2 SELECT fixes)
CREATE OR REPLACE FUNCTION ontology.create_structural_edges_for_level()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_mandala_node_id UUID;
  v_sector_node_id UUID;
  v_user_id UUID;
BEGIN
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO v_user_id FROM public.user_mandalas WHERE id = NEW.mandala_id;
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_mandala_node_id FROM ontology.nodes
    WHERE source_ref->>'table' = 'user_mandalas' AND source_ref->>'id' = NEW.mandala_id::text;

  SELECT id INTO v_sector_node_id FROM ontology.nodes
    WHERE source_ref->>'table' = 'user_mandala_levels' AND source_ref->>'id' = NEW.id::text;

  IF v_mandala_node_id IS NOT NULL AND v_sector_node_id IS NOT NULL THEN
    INSERT INTO ontology.edges (user_id, source_id, target_id, relation)
    VALUES (v_user_id, v_mandala_node_id, v_sector_node_id, 'CONTAINS')
    ON CONFLICT (source_id, target_id, relation) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2. create_goal_edge (2 SELECT fixes)
CREATE OR REPLACE FUNCTION ontology.create_goal_edge()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user_id UUID;
  v_goal_node_id UUID;
  v_sector_node_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF COALESCE(NULLIF(NEW.center_goal, ''), NULL) IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO v_user_id FROM public.user_mandalas WHERE id = NEW.mandala_id;
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_goal_node_id FROM ontology.nodes
    WHERE source_ref->>'table' = 'user_mandala_levels_goal' AND source_ref->>'id' = NEW.id::text;

  SELECT id INTO v_sector_node_id FROM ontology.nodes
    WHERE source_ref->>'table' = 'user_mandala_levels' AND source_ref->>'id' = NEW.id::text;

  IF v_goal_node_id IS NOT NULL AND v_sector_node_id IS NOT NULL THEN
    INSERT INTO ontology.edges (user_id, source_id, target_id, relation)
    VALUES (v_user_id, v_sector_node_id, v_goal_node_id, 'CONTAINS')
    ON CONFLICT (source_id, target_id, relation) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$function$;

-- 3. create_topic_edges (2 SELECT fixes, one inside loop)
CREATE OR REPLACE FUNCTION ontology.create_topic_edges()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user_id UUID;
  v_sector_node_id UUID;
  v_topic_node_id UUID;
  v_subject TEXT;
  v_new_subjects TEXT[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  SELECT user_id INTO v_user_id FROM public.user_mandalas WHERE id = NEW.mandala_id;
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT id INTO v_sector_node_id FROM ontology.nodes
    WHERE source_ref->>'table' = 'user_mandala_levels' AND source_ref->>'id' = NEW.id::text;

  IF v_sector_node_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_new_subjects := COALESCE(NEW.subjects, ARRAY[]::TEXT[]);

  FOREACH v_subject IN ARRAY v_new_subjects LOOP
    IF v_subject <> '' THEN
      SELECT id INTO v_topic_node_id FROM ontology.nodes
        WHERE source_ref->>'table' = 'user_mandala_levels_topic' AND source_ref->>'id' = NEW.id::text || ':' || v_subject;

      IF v_topic_node_id IS NOT NULL THEN
        INSERT INTO ontology.edges (user_id, source_id, target_id, relation)
        VALUES (v_user_id, v_sector_node_id, v_topic_node_id, 'CONTAINS')
        ON CONFLICT (source_id, target_id, relation) DO NOTHING;
      END IF;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$function$;

-- 4. sync_mandala_level (DELETE + UPDATE WHERE fixes)
CREATE OR REPLACE FUNCTION ontology.sync_mandala_level()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM ontology.nodes
    WHERE source_ref->>'table' = 'user_mandala_levels' AND source_ref->>'id' = OLD.id::text;
    RETURN OLD;
  END IF;

  SELECT user_id INTO v_user_id FROM public.user_mandalas WHERE id = NEW.mandala_id;
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref)
    VALUES (
      v_user_id,
      'mandala_sector',
      COALESCE(NULLIF(NEW.center_goal, ''), NEW.level_key),
      jsonb_build_object(
        'level_key', NEW.level_key,
        'center_goal', NEW.center_goal,
        'subjects', to_jsonb(NEW.subjects),
        'position', NEW.position,
        'depth', NEW.depth
      ),
      jsonb_build_object('table', 'user_mandala_levels', 'id', NEW.id::text)
    )
    ON CONFLICT ((source_ref->>'table'), (source_ref->>'id')) WHERE source_ref IS NOT NULL DO UPDATE
    SET title = EXCLUDED.title,
        properties = EXCLUDED.properties,
        updated_at = now();

    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE ontology.nodes SET
      title = COALESCE(NULLIF(NEW.center_goal, ''), NEW.level_key),
      properties = jsonb_build_object(
        'level_key', NEW.level_key,
        'center_goal', NEW.center_goal,
        'subjects', to_jsonb(NEW.subjects),
        'position', NEW.position,
        'depth', NEW.depth
      ),
      updated_at = now()
    WHERE source_ref->>'table' = 'user_mandala_levels' AND source_ref->>'id' = NEW.id::text;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$function$;

-- 5. sync_goal (DELETE WHERE fixes)
CREATE OR REPLACE FUNCTION ontology.sync_goal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  v_user_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM ontology.nodes
    WHERE source_ref->>'table' = 'user_mandala_levels_goal' AND source_ref->>'id' = OLD.id::text;
    RETURN OLD;
  END IF;

  SELECT user_id INTO v_user_id FROM public.user_mandalas WHERE id = NEW.mandala_id;
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NULLIF(NEW.center_goal, ''), NULL) IS NOT NULL THEN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref)
      VALUES (
        v_user_id,
        'goal',
        NEW.center_goal,
        jsonb_build_object(
          'level_key', NEW.level_key,
          'depth', NEW.depth,
          'mandala_id', NEW.mandala_id
        ),
        jsonb_build_object('table', 'user_mandala_levels_goal', 'id', NEW.id::text)
      )
      ON CONFLICT ((source_ref->>'table'), (source_ref->>'id')) WHERE source_ref IS NOT NULL DO UPDATE
      SET title = EXCLUDED.title,
          properties = EXCLUDED.properties,
          updated_at = now();

      RETURN NEW;

    ELSIF TG_OP = 'UPDATE' THEN
      INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref)
      VALUES (
        v_user_id,
        'goal',
        NEW.center_goal,
        jsonb_build_object(
          'level_key', NEW.level_key,
          'depth', NEW.depth,
          'mandala_id', NEW.mandala_id
        ),
        jsonb_build_object('table', 'user_mandala_levels_goal', 'id', NEW.id::text)
      )
      ON CONFLICT ((source_ref->>'table'), (source_ref->>'id')) WHERE source_ref IS NOT NULL DO UPDATE
      SET title = EXCLUDED.title,
          properties = EXCLUDED.properties,
          updated_at = now();

      RETURN NEW;
    END IF;
  ELSE
    DELETE FROM ontology.nodes
    WHERE source_ref->>'table' = 'user_mandala_levels_goal' AND source_ref->>'id' = NEW.id::text;

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$function$;

-- 6. sync_topics — DELETE path already uses extracted keys, no change needed.
-- Included here for completeness documentation only.

COMMIT;
