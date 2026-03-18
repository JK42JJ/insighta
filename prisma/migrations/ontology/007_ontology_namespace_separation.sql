-- ============================================================================
-- Ontology Phase A.1-ext: Namespace Separation (Service vs System)
-- ============================================================================
-- Adds `domain` column to object_types and relation_types to separate
-- Service (user knowledge management) vs System (dev agent) ontology.
-- Values: 'service' (default), 'system', 'shared'
-- ============================================================================

-- Add domain column to object_types
ALTER TABLE ontology.object_types
  ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT 'service';

-- Tag system (dev) object types
UPDATE ontology.object_types
  SET domain = 'system'
  WHERE code IN ('pattern', 'decision', 'problem');

-- Add domain column to relation_types
ALTER TABLE ontology.relation_types
  ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT 'service';

-- Tag system (dev) relation types
UPDATE ontology.relation_types
  SET domain = 'system'
  WHERE code IN ('RESOLVES', 'DEPENDS_ON');

-- Tag shared relation types
UPDATE ontology.relation_types
  SET domain = 'shared'
  WHERE code = 'RELATED_TO';

-- Add CHECK constraint for valid domain values
ALTER TABLE ontology.object_types
  ADD CONSTRAINT chk_object_types_domain
  CHECK (domain IN ('service', 'system', 'shared'));

ALTER TABLE ontology.relation_types
  ADD CONSTRAINT chk_relation_types_domain
  CHECK (domain IN ('service', 'system', 'shared'));
