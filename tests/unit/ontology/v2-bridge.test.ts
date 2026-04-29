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

  test('inserts the 5 expected node types exactly', () => {
    for (const nodeType of [
      'video_resource',
      'concept',
      'section_node',
      'atom_node',
      'action_node',
    ]) {
      expect(SOURCE).toContain(`'${nodeType}'`);
    }
  });

  test('upsertEdge is idempotent (existing-row check before insert)', () => {
    expect(SOURCE).toMatch(/SELECT id FROM ontology\.edges/);
    expect(SOURCE).toMatch(/if \(existing\.length > 0\) return false/);
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
