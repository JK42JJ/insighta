-- ============================================================================
-- Ontology Phase B.1: Shadow Node Sync Triggers
-- ============================================================================
-- ADR-2: Materialize-on-Reference
-- public schema entity changes → auto-sync to ontology.nodes as shadow nodes
-- ============================================================================

-- ============================================================================
-- user_local_cards → ontology.nodes (type: 'resource')
-- ============================================================================

CREATE OR REPLACE FUNCTION ontology.sync_local_card()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref)
    VALUES (
      NEW.user_id,
      'resource',
      COALESCE(NEW.title, NEW.metadata_title, NEW.url),
      jsonb_build_object(
        'url', NEW.url,
        'link_type', NEW.link_type,
        'thumbnail', COALESCE(NEW.thumbnail, NEW.metadata_image),
        'user_note', NEW.user_note
      ),
      jsonb_build_object('table', 'user_local_cards', 'id', NEW.id::text)
    )
    ON CONFLICT ((source_ref->>'table'), (source_ref->>'id')) WHERE source_ref IS NOT NULL DO UPDATE
    SET title = EXCLUDED.title,
        properties = EXCLUDED.properties,
        updated_at = now();

    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE ontology.nodes SET
      title = COALESCE(NEW.title, NEW.metadata_title, NEW.url),
      properties = jsonb_build_object(
        'url', NEW.url,
        'link_type', NEW.link_type,
        'thumbnail', COALESCE(NEW.thumbnail, NEW.metadata_image),
        'user_note', NEW.user_note
      ),
      updated_at = now()
    WHERE source_ref = jsonb_build_object('table', 'user_local_cards', 'id', NEW.id::text);

    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM ontology.nodes
    WHERE source_ref = jsonb_build_object('table', 'user_local_cards', 'id', OLD.id::text);

    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_sync_local_card
  AFTER INSERT OR UPDATE OR DELETE ON public.user_local_cards
  FOR EACH ROW EXECUTE FUNCTION ontology.sync_local_card();

-- ============================================================================
-- user_mandalas → ontology.nodes (type: 'mandala')
-- ============================================================================

CREATE OR REPLACE FUNCTION ontology.sync_mandala()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO ontology.nodes (user_id, type, title, properties, source_ref)
    VALUES (
      NEW.user_id,
      'mandala',
      NEW.title,
      jsonb_build_object('is_default', NEW.is_default, 'position', NEW.position),
      jsonb_build_object('table', 'user_mandalas', 'id', NEW.id::text)
    )
    ON CONFLICT ((source_ref->>'table'), (source_ref->>'id')) WHERE source_ref IS NOT NULL DO UPDATE
    SET title = EXCLUDED.title,
        properties = EXCLUDED.properties,
        updated_at = now();

    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    UPDATE ontology.nodes SET
      title = NEW.title,
      properties = jsonb_build_object('is_default', NEW.is_default, 'position', NEW.position),
      updated_at = now()
    WHERE source_ref = jsonb_build_object('table', 'user_mandalas', 'id', NEW.id::text);

    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM ontology.nodes
    WHERE source_ref = jsonb_build_object('table', 'user_mandalas', 'id', OLD.id::text);

    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_sync_mandala
  AFTER INSERT OR UPDATE OR DELETE ON public.user_mandalas
  FOR EACH ROW EXECUTE FUNCTION ontology.sync_mandala();

-- ============================================================================
-- user_mandala_levels → ontology.nodes (type: 'mandala_sector')
-- ============================================================================

CREATE OR REPLACE FUNCTION ontology.sync_mandala_level()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM ontology.nodes
    WHERE source_ref = jsonb_build_object('table', 'user_mandala_levels', 'id', OLD.id::text);
    RETURN OLD;
  END IF;

  -- Lookup user_id from parent mandala
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
    WHERE source_ref = jsonb_build_object('table', 'user_mandala_levels', 'id', NEW.id::text);

    RETURN NEW;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_sync_mandala_level
  AFTER INSERT OR UPDATE OR DELETE ON public.user_mandala_levels
  FOR EACH ROW EXECUTE FUNCTION ontology.sync_mandala_level();

-- ============================================================================
-- youtube_videos → ontology.nodes (type: 'source')
-- Note: youtube_videos has no user_id column — shadow nodes are created
-- when a user_local_card references the video (via separate trigger below)
-- ============================================================================

CREATE OR REPLACE FUNCTION ontology.sync_youtube_video()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- youtube_videos has no user_id, so we skip direct shadow creation.
    -- Shadow nodes for videos are created when cards reference them.
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    -- Update any existing shadow nodes that reference this video
    UPDATE ontology.nodes SET
      title = NEW.title,
      properties = jsonb_build_object(
        'youtube_video_id', NEW.youtube_video_id,
        'channel_title', NEW.channel_title,
        'thumbnail_url', NEW.thumbnail_url,
        'duration_seconds', NEW.duration_seconds
      ),
      updated_at = now()
    WHERE source_ref = jsonb_build_object('table', 'youtube_videos', 'id', NEW.id::text);

    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    DELETE FROM ontology.nodes
    WHERE source_ref = jsonb_build_object('table', 'youtube_videos', 'id', OLD.id::text);

    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_sync_youtube_video
  AFTER UPDATE OR DELETE ON public.youtube_videos
  FOR EACH ROW EXECUTE FUNCTION ontology.sync_youtube_video();
