-- 016: Add MENTIONS and SIMILAR_TO relation types for KG Bridge v2
-- Idempotent: ON CONFLICT DO NOTHING
-- Issue: #504, #505

INSERT INTO ontology.relation_types (code, label, inverse, description, domain)
VALUES
  ('MENTIONS', 'Mentions', 'MENTIONED_BY', 'Resource mentions existing node via FTS text match', 'service'),
  ('SIMILAR_TO', 'Similar To', 'SIMILAR_TO', 'Embedding cosine similarity above threshold', 'service')
ON CONFLICT (code) DO NOTHING;
