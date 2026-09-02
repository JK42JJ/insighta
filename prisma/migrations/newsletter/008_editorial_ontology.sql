-- The brief's own corner of the graph.
--
-- The ontology already holds 210,830 nodes, and none of them can serve a
-- newsletter. They are one reader's: 25,337 `concept` nodes belonging to a
-- single user_id, and reading them shows why — 무텐트존, 구축 아파트, 철거,
-- S라인 트림. Camping, interior work, car trims. Real concepts, extracted from
-- that reader's own mandala, and entirely unrelated to AI engineering.
--
-- So the brief cannot borrow a vocabulary; it needs one, in the same tables,
-- under its own domain. `object_types.domain` already separates `service`
-- (a user's own graph) from `system` (the development agents). Editorial is
-- the third owner: not a user's, not the agents', and it must not be readable
-- as either — a reader's graph filling with conference-talk concepts they
-- never saved would be a defect, not a feature.
--
--   local : docker exec -i supabase-db-dev sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" \
--             psql -U supabase_admin -d postgres' < 008_editorial_ontology.sql
--   prod  : psql "$DIRECT_URL" -f 008_editorial_ontology.sql
--
-- Idempotent.

-- `nodes.type` carries a foreign key to this table, so a type that is not
-- registered cannot be inserted. That constraint is the reason this migration
-- exists rather than the code simply writing rows.
INSERT INTO ontology.object_types (code, label, category, description, domain)
VALUES
  -- A concept the brief names: prompt injection, quantization, agent harness.
  -- Curated, versioned in the repo, and never machine-invented — the file that
  -- defines them is reviewed the way the trusted-channel list is.
  ('editorial_concept', 'Editorial Concept', 'knowledge',
   'A concept the weekly brief names. Curated in docs/newsletter/ontology.', 'shared'),
  -- A harvested video, as the graph sees it. Distinct from `video_resource`,
  -- which means "a video this reader saved".
  ('editorial_video', 'Editorial Video', 'resource',
   'A video the brief harvested. Not owned by any reader.', 'shared'),
  -- One published issue. Gives every claim a home and lets a later issue ask
  -- what the last one said.
  ('editorial_issue', 'Editorial Issue', 'structure',
   'One published issue of a weekly brief.', 'shared')
ON CONFLICT (code) DO NOTHING;

-- Relations are declared too. `edges.relation` carries a foreign key to
-- `relation_types`, which is how the schema stopped the first version of the
-- bridge: it wrote BROADER edges and the database refused them. The table also
-- names each relation's inverse, so a reader of the graph can traverse either
-- way without a convention held in someone's head.
INSERT INTO ontology.relation_types (code, label, inverse, description, domain)
VALUES
  -- The edge that gives the vocabulary a level. `prompt-injection BROADER
  -- ai-security` is what lets S5 count at the leaf and summarise at the branch;
  -- without it every concept is a peer and `agent` drowns the week.
  ('BROADER', 'Broader', 'NARROWER',
   'Child concept sits under a broader concept. One level only.', 'shared'),
  -- A harvested video names a concept. The count of distinct channels on this
  -- edge is the corroboration test.
  ('MENTIONS', 'Mentions', 'MENTIONED_BY',
   'An editorial video names an editorial concept.', 'shared')
ON CONFLICT (code) DO NOTHING;

-- Domain isolation, enforced rather than documented.
--
-- CLAUDE.md states the rule ("Service != System ... Cross-domain 금지") and
-- until now nothing checked it: `domain` is nullable and every existing row
-- simply says 'service'. An edge that crossed from editorial into a reader's
-- graph would be invisible until a reader noticed someone else's vocabulary
-- in their own notes.
CREATE OR REPLACE FUNCTION ontology.assert_edge_domain() RETURNS trigger AS $$
DECLARE
  src_domain text;
  tgt_domain text;
BEGIN
  SELECT ot.domain INTO src_domain
    FROM ontology.nodes n JOIN ontology.object_types ot ON ot.code = n.type
   WHERE n.id = NEW.source_id;
  SELECT ot.domain INTO tgt_domain
    FROM ontology.nodes n JOIN ontology.object_types ot ON ot.code = n.type
   WHERE n.id = NEW.target_id;

  IF src_domain IS DISTINCT FROM tgt_domain THEN
    RAISE EXCEPTION
      'edge crosses domains: % (%) -> % (%). Domains are namespaces, not labels.',
      NEW.source_id, src_domain, NEW.target_id, tgt_domain;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_edges_domain ON ontology.edges;
CREATE TRIGGER trg_edges_domain
  BEFORE INSERT OR UPDATE ON ontology.edges
  FOR EACH ROW EXECUTE FUNCTION ontology.assert_edge_domain();

-- One node per (owner, type, title). The bridge re-runs every week and must
-- find last week's concepts rather than making second copies of them — that
-- is what makes a concept's history, and therefore the timeline, possible.
CREATE UNIQUE INDEX IF NOT EXISTS uq_ontology_nodes_editorial_title
  ON ontology.nodes (user_id, type, title)
  WHERE type IN ('editorial_concept', 'editorial_video', 'editorial_issue');
