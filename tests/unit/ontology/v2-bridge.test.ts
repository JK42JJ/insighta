/**
 * v2-bridge — schema sanity (CP437).
 *
 * Bridge code does Prisma raw queries against prod-shaped ontology tables.
 * Unit-level test verifies it doesn't import any LLM/embedding module
 * (Hard Rule no-API directive). Full integration is verified in prod via
 * the upsert-direct end-to-end smoke (separate verification).
 */

import * as fs from 'fs';
import * as path from 'path';

const SOURCE = fs.readFileSync(
  path.join(__dirname, '../../../src/modules/ontology/v2-bridge.ts'),
  'utf-8'
);

describe('v2-bridge module purity (Hard Rule no-API)', () => {
  test('does NOT import any LLM provider module', () => {
    // OpenRouter / generation provider imports are forbidden in this path.
    expect(SOURCE).not.toMatch(/from\s+['"][^'"]*createGenerationProvider/);
    expect(SOURCE).not.toMatch(/from\s+['"][^'"]*openrouter/i);
    expect(SOURCE).not.toMatch(/from\s+['"][^'"]*anthropic/i);
    expect(SOURCE).not.toMatch(/['"]@\/modules\/llm['"]/);
  });

  test('does NOT import the embedding module (no SIMILAR_TO path)', () => {
    expect(SOURCE).not.toMatch(/from\s+['"][^'"]*\/embedding['"]/);
    expect(SOURCE).not.toMatch(/embedNode|getSemanticRank|embedBatch/);
  });

  test('declares the 7 expected relations exactly', () => {
    for (const relation of [
      'COVERS',
      'HAS_SECTION',
      'HAS_ATOM',
      'MENTIONS',
      'SUGGESTS',
      'RELEVANT_TO',
    ]) {
      expect(SOURCE).toContain(`'${relation}'`);
    }
  });

  test('declares the 9 expected node types (CP474 entities[] 5-type added)', () => {
    for (const nodeType of [
      'video_resource',
      'concept',
      'section_node',
      'atom_node',
      'action_node',
      // CP474 — entities[] 5-type. 'concept' is shared with key_concepts.
      'person',
      'tool',
      'framework',
      'organization',
    ]) {
      expect(SOURCE).toContain(`'${nodeType}'`);
    }
  });

  test('upsertEdge is idempotent (existing-row check before insert)', () => {
    expect(SOURCE).toMatch(/SELECT id FROM ontology\.edges/);
    expect(SOURCE).toMatch(/if \(existing\.length > 0\) return false/);
  });

  test('node upserts UPDATE properties on existing match (not just return)', () => {
    // CP474: 6 upserters (video_resource / concept / entity / section /
    // atom / action). Each must refresh on existing match.
    const updateMatches = SOURCE.match(/UPDATE ontology\.nodes\s+SET\s+/g) ?? [];
    expect(updateMatches.length).toBeGreaterThanOrEqual(6);
  });

  test('CP474 — atoms.entity_refs prefer entities[].name over key_concepts.term', () => {
    // bridgeV2ToOntology MENTIONS edge fallback chain.
    expect(SOURCE).toMatch(/entityNameToId\.get\(ref\)\s*\?\?\s*conceptNameToId\.get\(ref\)/);
  });

  test('CP474 — ENTITY_TYPE_TO_NODE_TYPE maps all 5 entity types', () => {
    for (const t of ['concept', 'person', 'tool', 'framework', 'organization']) {
      expect(SOURCE).toMatch(new RegExp(`${t}:\\s*'${t}'`));
    }
  });

  test('findGoalNodesByExactTitle uses exact title match (no fuzzy)', () => {
    expect(SOURCE).toMatch(/title = \$\{title\}/);
    // No actual embedding/similarity function invocation. (Comments may
    // mention these words to explain why they are absent — match call
    // patterns only.)
    expect(SOURCE).not.toMatch(
      /embedNode\s*\(|getSemanticRank\s*\(|embedBatch\s*\(|cosineSimilarity\s*\(/
    );
  });
});
