-- 021: user context types (per-user learning context in the ontology graph).
-- Object types: user_context, format, channel. Relation types: WANTS, AVOIDS, JUDGED.
-- Writer: src/modules/user-context/store.ts (persistGraph). Reader: readContext.
--   user_context ─CONTAINS→ mandala_sector ─RELEVANT_TO→ concept
--   user_context ─WANTS / AVOIDS→ concept | format | channel
--   user_context ─JUDGED→ video_resource ─COVERS→ concept, ─TAGGED_WITH→ format | channel
-- Dictionary rows only; no table or column change. Idempotent: ON CONFLICT (code) DO NOTHING.
-- stg first; prod by separate approval.

BEGIN;

INSERT INTO ontology.object_types (code, label, category, description, is_active, domain) VALUES
  ('user_context', '사용자 맥락', 'structure', '사용자별 학습 맥락의 루트 노드 (목표 문장, 이유, 수준, 언어, 최신성, 버전, 난이도 선호)', true, 'service'),
  ('format',       '영상 형식',   'knowledge', '영상 형식 태그 (강의, 튜토리얼, 인터뷰 등 content_type)', true, 'service'),
  ('channel',      '채널',        'source',    'YouTube 채널 (properties.channel_id)', true, 'service')
ON CONFLICT (code) DO NOTHING;

-- relation_types.inverse is NOT NULL; only the forward edge is written.
INSERT INTO ontology.relation_types (code, label, inverse, description, is_active, domain) VALUES
  ('WANTS',  '원함',   'WANTED_BY',  '사용자 맥락이 개념/형식/채널을 원함 (weight = 선호 크기, 0 이상)', true, 'service'),
  ('AVOIDS', '피함',   'AVOIDED_BY', '사용자 맥락이 개념/형식/채널을 피함 (weight = 회피 크기, 0 이상)', true, 'service'),
  ('JUDGED', '판정함', 'JUDGED_BY',  '사용자 맥락이 영상을 판정함 (properties: verdict useful|skip|pass, watched_seconds, day, batch_id, arm)', true, 'service')
ON CONFLICT (code) DO NOTHING;

COMMIT;

-- Validation:
-- SELECT COUNT(*) FROM ontology.object_types WHERE code IN ('user_context','format','channel');  -- expected 3
-- SELECT COUNT(*) FROM ontology.relation_types WHERE code IN ('WANTS','AVOIDS','JUDGED');        -- expected 3
--
-- Rollback (only when unused — FKs from nodes.type / edges.relation would block the delete anyway):
-- BEGIN;
-- DELETE FROM ontology.relation_types r WHERE r.code IN ('WANTS','AVOIDS','JUDGED')
--   AND NOT EXISTS (SELECT 1 FROM ontology.edges e WHERE e.relation = r.code);
-- DELETE FROM ontology.object_types o WHERE o.code IN ('user_context','format','channel')
--   AND NOT EXISTS (SELECT 1 FROM ontology.nodes n WHERE n.type = o.code);
-- COMMIT;
