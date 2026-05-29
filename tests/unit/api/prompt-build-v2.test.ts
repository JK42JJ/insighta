/**
 * Smoke: /api/v1/internal/prompt/build-v2 contract (CP488+ 2026-05-29).
 *
 * Direct unit cover on `buildV2Prompt` since the route is a thin DB-fetch +
 * buildV2Prompt wrapper. Asserts that the SAME 4 enrichment fields the
 * Mac Mini PROMPT_HEADER fork was missing are present in the prod prompt
 * template — guards against regression of the fork that caused CP488+
 * post-mortem (433 backfill rows lacking entities / relevance_pct /
 * key_points / entity_refs).
 */

import { buildV2Prompt } from '@/modules/skills/rich-summary-v2-prompt';

describe('prompt/build-v2 enrichment field coverage', () => {
  const baseInput = {
    title: '비트코인 분석',
    description: '시장 분석',
    channel: 'BTC TV',
    language: 'ko' as const,
    transcript: '[00:00] 안녕하세요\n[00:30] 본론 시작',
    durationSeconds: 600,
  };

  test('prompt mentions analysis.entities with typed vocabulary', () => {
    const prompt = buildV2Prompt(baseInput);
    expect(prompt).toMatch(/"entities":/);
    expect(prompt).toMatch(/concept \| person \| tool \| framework \| organization/);
  });

  test('prompt mentions segments.sections[].relevance_pct (intra-video)', () => {
    const prompt = buildV2Prompt(baseInput);
    expect(prompt).toMatch(/relevance_pct/);
    expect(prompt).toMatch(/intra-video metric for THIS section/);
  });

  test('prompt mentions sections[].key_points[] with timestamp_sec', () => {
    const prompt = buildV2Prompt(baseInput);
    expect(prompt).toMatch(/key_points/);
    expect(prompt).toMatch(/1-3 key_points/);
  });

  test('prompt mentions atoms[].entity_refs linking to entities', () => {
    const prompt = buildV2Prompt(baseInput);
    expect(prompt).toMatch(/entity_refs/);
    expect(prompt).toMatch(/links to analysis\.entities\[\]\.name/);
  });

  test('prompt mentions [mm:ss] markers + duration cap (Phase 1.5)', () => {
    const prompt = buildV2Prompt(baseInput);
    expect(prompt).toMatch(/\[mm:ss\]/);
    expect(prompt).toMatch(/Video duration: 600 seconds/);
    expect(prompt).toMatch(/Video duration × 1\.05/);
  });

  test('language override + mandalaCenterGoal both reflected', () => {
    const prompt = buildV2Prompt({
      ...baseInput,
      language: 'en',
      mandalaCenterGoal: 'Master crypto fundamentals',
    });
    expect(prompt).toMatch(/Output language MUST be en/);
    expect(prompt).toMatch(/Master crypto fundamentals/);
  });
});
