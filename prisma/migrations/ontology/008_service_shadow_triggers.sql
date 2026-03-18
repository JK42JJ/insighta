-- ============================================================================
-- Ontology Phase B.2: Service Shadow Triggers (goal, topic, note)
-- ============================================================================
-- Extends 004_shadow_triggers.sql with triggers for service ontology types.
-- All nodes created by these triggers belong to domain='service' (via object_types).
-- source_segment is skipped: video_captions has no user_id and segments is a JSON blob.
-- ============================================================================

-- ============================================================================
-- user_mandala_levels.center_goal → ontology.nodes (type: 'goal')
-- Creates a goal node when center_goal is non-empty.
-- ============================================================================

CREATE OR REPLACE FUNCTION ontology.sync_goal()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM ontology.nodes
    WHERE source_ref = jsonb_build_object('table', 'user_mandala_levels_goal', 'id', OLD.id::text);
    RETURN OLD;
  END IF;

  -- Lookup user_id from parent mandala
  SELECT user_id INTO v_user_id FROM public.user_mandalas WHERE id = NEW.mandala_id;
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Only create goal node if center_goal is non-empty
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
      -- Upsert: may need to create if center_goal was empty before
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
    -- center_goal became empty — remove the goal node
    DELETE FROM ontology.nodes
    WHERE source_ref = jsonb_build_object('table', 'user_mandala_levels_goal', 'id', NEW.id::text);

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_goal ON public.user_mandala_levels;
CREATE TRIGGER trg_sync_goal
  AFTER INSERT OR UPDATE OR DELETE ON public.user_mandala_levels
  FOR EACH ROW EXECUTE FUNCTION ontology.sync_goal();

-- ============================================================================
-- user_mandala_levels.subjects[] → ontology.nodes (type: 'topic')
-- Creates one topic node per unique subject string.
-- Uses source_ref = {table: 'user_mandala_levels_topic', id: '<level_id>:<subject>'}
-- ============================================================================

CREATE OR REPLACE FUNCTION ontology.sync_topics()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
  v_subject TEXT;
  v_old_subjects TEXT[];
  v_new_subjects TEXT[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- Remove all topic nodes for this level
    DELETE FROM ontology.nodes
    WHERE source_ref->>'table' = 'user_mandala_levels_topic'
      AND source_ref->>'id' LIKE OLD.id::text || ':%';
    RETURN OLD;
  END IF;

  -- Lookup user_id from parent mandala
  SELECT user_id INTO v_user_id FROM public.user_mandalas WHERE id = NEW.mandala_id;
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  v_new_subjects := COALESCE(NEW.subjects, ARRAY[]::TEXT[]);

  IF TG_OP = 'UPDATE' THEN
    v_old_subjects := COALESCE(OLD.subjects, ARRAY[]::TEXT[]);

    -- Remove topics that were removed
    FOREACH v_subject IN ARRAY v_old_subjects LOOP
      IF v_subject <> '' AND NOT (v_subject = ANY(v_new_subjects)) THEN
        DELETE FROM ontology.nodes
        WHERE source_ref = jsonb_build_object('table', 'user_mandala_levels_topic', 'id', NEW.id::text || ':' || v_subject);
      END IF;
    END LOOP;
  END IF;

  -- Upsert topics for current subjects
  FOREACH v_subject IN ARRAY v_new_subjects LOOP
    IF v_subject <> '' THEN
      INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref)
      VALUES (
        v_user_id,
        'topic',
        v_subject,
        jsonb_build_object(
          'level_key', NEW.level_key,
          'depth', NEW.depth,
          'mandala_id', NEW.mandala_id
        ),
        jsonb_build_object('table', 'user_mandala_levels_topic', 'id', NEW.id::text || ':' || v_subject)
      )
      ON CONFLICT ((source_ref->>'table'), (source_ref->>'id')) WHERE source_ref IS NOT NULL DO UPDATE
      SET title = EXCLUDED.title,
          properties = EXCLUDED.properties,
          updated_at = now();
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_topics ON public.user_mandala_levels;
CREATE TRIGGER trg_sync_topics
  AFTER INSERT OR UPDATE OR DELETE ON public.user_mandala_levels
  FOR EACH ROW EXECUTE FUNCTION ontology.sync_topics();

-- ============================================================================
-- video_notes → ontology.nodes (type: 'note')
-- ============================================================================

CREATE OR REPLACE FUNCTION ontology.sync_video_note()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM ontology.nodes
    WHERE source_ref = jsonb_build_object('table', 'video_notes', 'id', OLD.id::text);
    RETURN OLD;
  END IF;

  -- video_notes has no user_id — look up via card that references this video
  SELECT DISTINCT c.user_id INTO v_user_id
  FROM public.user_local_cards c
  JOIN public.youtube_videos v ON c.url LIKE '%' || v.youtube_video_id || '%'
  WHERE v.id = NEW.video_id
  LIMIT 1;

  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref)
    VALUES (
      v_user_id,
      'note',
      LEFT(NEW.content, 200),
      jsonb_build_object(
        'video_id', NEW.video_id,
        'timestamp_seconds', NEW.timestamp_seconds,
        'tags', NEW.tags
      ),
      jsonb_build_object('table', 'video_notes', 'id', NEW.id::text)
    )
    ON CONFLICT ((source_ref->>'table'), (source_ref->>'id')) WHERE source_ref IS NOT NULL DO UPDATE
    SET title = EXCLUDED.title,
        properties = EXCLUDED.properties,
        updated_at = now();

    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE ontology.nodes SET
      title = LEFT(NEW.content, 200),
      properties = jsonb_build_object(
        'video_id', NEW.video_id,
        'timestamp_seconds', NEW.timestamp_seconds,
        'tags', NEW.tags
      ),
      updated_at = now()
    WHERE source_ref = jsonb_build_object('table', 'video_notes', 'id', NEW.id::text);

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_video_note ON public.video_notes;
CREATE TRIGGER trg_sync_video_note
  AFTER INSERT OR UPDATE OR DELETE ON public.video_notes
  FOR EACH ROW EXECUTE FUNCTION ontology.sync_video_note();
