-- CP437 (2026-04-29) — register v2-summary node + edge types in ontology.
--
-- Per the user-approved gap analysis (defaults):
--   - RELATES_TO is NEW (not the same as the existing RELATED_TO);
--     spec uses both spellings deliberately.
--   - SIMILAR_TO / RELATED_TO 기존 row 유지 (변경 없음).
--   - embedding 미사용 (Hard Rule no API). MENTIONS / COVERS / RELEVANT_TO
--     / SUGGESTS / ENABLES / HAS_SECTION / HAS_ATOM 만 코드 경로에서 사용.
--
-- Idempotent: ON CONFLICT DO NOTHING.

BEGIN;

INSERT INTO ontology.object_types (code, label, category, description, is_active, domain) VALUES
  ('video_resource', 'Video Resource',  'resource',     'Global YouTube video metadata (youtube_videos.youtube_video_id)', true, 'service'),
  ('concept',        'Concept',         'knowledge',    'Concept extracted from rich-summary v2 analysis.key_concepts', true, 'service'),
  ('section_node',   'Section',         'rich_summary', 'Time-anchored section extracted from rich-summary v2 segments.sections', true, 'service'),
  ('atom_node',      'Atom',            'rich_summary', 'Time-anchored insight atom extracted from rich-summary v2 segments.atoms', true, 'service'),
  ('action_node',    'Action',          'action',       'Actionable extracted from rich-summary v2 analysis.actionables', true, 'service')
ON CONFLICT (code) DO NOTHING;

-- Note: ontology.relation_types.inverse is NOT NULL. Symmetric relations
-- (RELATES_TO) self-pair like the existing RELATED_TO/SIMILAR_TO; directional
-- relations get a paired inverse code that we may or may not register
-- separately (only the forward edge is written by the v2-bridge code path).
INSERT INTO ontology.relation_types (code, label, inverse, description, is_active, domain) VALUES
  ('RELEVANT_TO',   'Relevant To',  'ATTRACTS',     'Video resource is relevant to goal (mandala_fit.suggested_goals match)', true, 'service'),
  ('COVERS',        'Covers',       'COVERED_BY',   'Video resource covers a concept (analysis.key_concepts)', true, 'service'),
  ('HAS_SECTION',   'Has Section',  'SECTION_OF',   'Video resource has a section (segments.sections)', true, 'service'),
  ('HAS_ATOM',      'Has Atom',     'ATOM_OF',      'Video resource (or section) has an atom (segments.atoms)', true, 'service'),
  ('SUGGESTS',      'Suggests',     'SUGGESTED_BY', 'Video resource suggests an action (analysis.actionables)', true, 'service'),
  ('ENABLES',       'Enables',      'ENABLED_BY',   'Concept enables a goal (downstream graph reasoning)', true, 'service'),
  ('RELATES_TO',    'Relates To',   'RELATES_TO',   'General relation between rich-summary nodes (kept distinct from existing RELATED_TO per CP437 spec)', true, 'service')
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- Validation:
-- SELECT COUNT(*) FROM ontology.object_types
--   WHERE code IN ('video_resource','concept','section_node','atom_node','action_node');
-- -- expected: 5
-- SELECT COUNT(*) FROM ontology.relation_types
--   WHERE code IN ('RELEVANT_TO','COVERS','HAS_SECTION','HAS_ATOM','SUGGESTS','ENABLES','RELATES_TO');
-- -- expected: 7
