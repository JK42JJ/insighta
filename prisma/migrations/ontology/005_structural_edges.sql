-- ============================================================================
-- Ontology Phase B.2: Structural Edge Auto-Generation
-- ============================================================================
-- Mandala structure edges: mandala CONTAINS sector, card PLACED_IN sector
-- ============================================================================

-- ============================================================================
-- mandala_level INSERT → CONTAINS edge (mandala → sector)
-- ============================================================================

CREATE OR REPLACE FUNCTION ontology.create_structural_edges_for_level()
RETURNS TRIGGER AS $$
DECLARE
  v_mandala_node_id UUID;
  v_sector_node_id UUID;
  v_user_id UUID;
BEGIN
  -- Only handle INSERT
  IF TG_OP != 'INSERT' THEN
    RETURN NEW;
  END IF;

  -- Get user_id from mandala
  SELECT user_id INTO v_user_id FROM public.user_mandalas WHERE id = NEW.mandala_id;
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find shadow nodes
  SELECT id INTO v_mandala_node_id FROM ontology.nodes
    WHERE source_ref = jsonb_build_object('table', 'user_mandalas', 'id', NEW.mandala_id::text);

  SELECT id INTO v_sector_node_id FROM ontology.nodes
    WHERE source_ref = jsonb_build_object('table', 'user_mandala_levels', 'id', NEW.id::text);

  -- Create CONTAINS edge: mandala → sector
  IF v_mandala_node_id IS NOT NULL AND v_sector_node_id IS NOT NULL THEN
    INSERT INTO ontology.edges (user_id, source_id, target_id, relation)
    VALUES (v_user_id, v_mandala_node_id, v_sector_node_id, 'CONTAINS')
    ON CONFLICT (source_id, target_id, relation) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- This trigger runs AFTER the shadow node trigger to ensure both nodes exist
CREATE TRIGGER trg_structural_edges_level
  AFTER INSERT ON public.user_mandala_levels
  FOR EACH ROW EXECUTE FUNCTION ontology.create_structural_edges_for_level();

-- ============================================================================
-- card placement change → PLACED_IN edge (resource → sector)
-- ============================================================================

CREATE OR REPLACE FUNCTION ontology.update_placed_in_edge()
RETURNS TRIGGER AS $$
DECLARE
  v_card_node_id UUID;
  v_sector_node_id UUID;
  v_level_ref JSONB;
BEGIN
  -- Only handle INSERT/UPDATE with level_id set
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  -- Find the card's shadow node
  SELECT id INTO v_card_node_id FROM ontology.nodes
    WHERE source_ref = jsonb_build_object('table', 'user_local_cards', 'id', NEW.id::text);

  IF v_card_node_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Remove existing PLACED_IN edges for this card
  DELETE FROM ontology.edges
    WHERE source_id = v_card_node_id AND relation = 'PLACED_IN';

  -- If card is placed in a level (not scratchpad), create PLACED_IN edge
  IF NEW.level_id IS NOT NULL AND NEW.level_id != 'scratchpad' AND NEW.mandala_id IS NOT NULL THEN
    -- Find the mandala_level by level_key + mandala_id
    SELECT jsonb_build_object('table', 'user_mandala_levels', 'id', uml.id::text)
    INTO v_level_ref
    FROM public.user_mandala_levels uml
    WHERE uml.mandala_id = NEW.mandala_id AND uml.level_key = NEW.level_id;

    IF v_level_ref IS NOT NULL THEN
      SELECT id INTO v_sector_node_id FROM ontology.nodes
        WHERE source_ref = v_level_ref;

      IF v_sector_node_id IS NOT NULL THEN
        INSERT INTO ontology.edges (user_id, source_id, target_id, relation)
        VALUES (NEW.user_id, v_card_node_id, v_sector_node_id, 'PLACED_IN')
        ON CONFLICT (source_id, target_id, relation) DO NOTHING;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_placed_in_edge
  AFTER INSERT OR UPDATE OF level_id, mandala_id ON public.user_local_cards
  FOR EACH ROW EXECUTE FUNCTION ontology.update_placed_in_edge();
