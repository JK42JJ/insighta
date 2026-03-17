-- ============================================================================
-- Ontology Phase A.1: Schema + Dictionary Tables + Seed Data
-- ============================================================================
-- ADR-1: Generic nodes/edges over typed tables
-- New entity type = 1 dictionary row, no schema migration needed
-- ============================================================================

-- Create ontology schema
CREATE SCHEMA IF NOT EXISTS ontology;

-- ============================================================================
-- Dictionary Tables
-- ============================================================================

CREATE TABLE ontology.object_types (
  code        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  category    TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE ontology.relation_types (
  code        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  inverse     TEXT NOT NULL,
  description TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE ontology.action_types (
  code        TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT
);

-- ============================================================================
-- Seed: object_types (12 types)
-- ============================================================================

INSERT INTO ontology.object_types (code, label, category, description) VALUES
  ('mandala',        'Mandala',         'structure',    'User mandala structure'),
  ('mandala_sector', 'Mandala Sector',  'structure',    'Mandala level/sector'),
  ('goal',           'Goal',            'structure',    'Center goal of a mandala sector'),
  ('topic',          'Topic',           'structure',    'Subject/topic tag'),
  ('resource',       'Resource',        'knowledge',    'Saved card or content entity'),
  ('note',           'Note',            'knowledge',    'User note or video note'),
  ('source',         'Source',          'source',       'YouTube video or external source'),
  ('source_segment', 'Source Segment',  'source',       'Caption segment or time range'),
  ('insight',        'Insight',         'knowledge',    'Derived insight (native ontology)'),
  ('pattern',        'Pattern',         'operational',  'Troubleshooting or recurring pattern'),
  ('decision',       'Decision',        'operational',  'Architecture or design decision'),
  ('problem',        'Problem',         'operational',  'Identified problem or issue');

-- ============================================================================
-- Seed: relation_types (8 types)
-- ============================================================================

INSERT INTO ontology.relation_types (code, label, inverse, description) VALUES
  ('CONTAINS',     'Contains',     'CONTAINED_BY',  'Parent contains child (mandala → sector → goal)'),
  ('DERIVED_FROM', 'Derived From', 'DERIVES',       'Insight derived from resource'),
  ('REFERENCES',   'References',   'REFERENCED_BY', 'Note references source segment'),
  ('PLACED_IN',    'Placed In',    'HOLDS',         'Resource placed in mandala cell'),
  ('RELATED_TO',   'Related To',   'RELATED_TO',    'Symmetric similarity relation'),
  ('RESOLVES',     'Resolves',     'RESOLVED_BY',   'Decision resolves problem'),
  ('DEPENDS_ON',   'Depends On',   'DEPENDED_BY',   'Resource dependency'),
  ('TAGGED_WITH',  'Tagged With',  'TAGS',          'Node tagged with topic');

-- ============================================================================
-- Seed: action_types (7 types)
-- ============================================================================

INSERT INTO ontology.action_types (code, label, description) VALUES
  ('CREATE_NODE',  'Create Node',  'New node created'),
  ('UPDATE_NODE',  'Update Node',  'Node properties updated'),
  ('DELETE_NODE',  'Delete Node',  'Node deleted'),
  ('ADD_EDGE',     'Add Edge',     'Edge created between nodes'),
  ('REMOVE_EDGE',  'Remove Edge',  'Edge removed'),
  ('EMBED',        'Embed',        'Node embedding generated'),
  ('BRIDGE_SYNC',  'Bridge Sync',  'Shadow node synced from public schema');
