/**
 * API Client URL Contract Test
 *
 * Ensures all api-client methods use correct URL patterns.
 * Catches the "/api/v1/api/v1/..." double-prefix bug (CP324).
 *
 * Rule: request() already prepends "/api/v1", so method endpoints
 * must NOT include "/api/v1" prefix.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const API_CLIENT_PATH = path.resolve(__dirname, '../../shared/lib/api-client.ts');

describe('API Client URL Contract', () => {
  const content = fs.readFileSync(API_CLIENT_PATH, 'utf-8');

  it('request() prepends /api/v1 to all endpoints', () => {
    expect(content).toContain('this.baseUrl}/api/v1${endpoint}');
  });

  it('no method passes /api/v1 prefix to request()', () => {
    // Extract all this.request('...') calls
    const requestCalls = content.matchAll(/this\.request\(\s*[`'"]([^`'"]+)[`'"]/g);
    const violations: string[] = [];

    for (const match of requestCalls) {
      const endpoint = match[1];
      if (endpoint.startsWith('/api/')) {
        violations.push(endpoint);
      }
    }

    expect(violations).toEqual([]);
  });

  it('all endpoints start with /', () => {
    const requestCalls = content.matchAll(/this\.request\(\s*[`'"]([^`'"]+)[`'"]/g);
    const violations: string[] = [];

    for (const match of requestCalls) {
      const endpoint = match[1];
      if (!endpoint.startsWith('/')) {
        violations.push(endpoint);
      }
    }

    expect(violations).toEqual([]);
  });

  it('skills methods use /skills prefix (not /api/v1/skills)', () => {
    const skillLines = content
      .split('\n')
      .filter((line) => line.includes("'/skills") || line.includes('`/skills'));

    expect(skillLines.length).toBeGreaterThanOrEqual(3); // list, preview, execute
    for (const line of skillLines) {
      expect(line).not.toContain('/api/v1/skills');
    }
  });

  it('searchTemplatesTypeahead uses /mandalas/templates/typeahead (no double prefix)', () => {
    expect(content).toContain('/mandalas/templates/typeahead');
    expect(content).not.toMatch(/\/api\/v1\/mandalas\/templates\/typeahead/);
  });

  it('listPublicTemplates uses /mandalas/templates-public (no double prefix)', () => {
    expect(content).toContain('/mandalas/templates-public');
    expect(content).not.toMatch(/\/api\/v1\/mandalas\/templates-public/);
  });

  // ─── CP488 — admin search-algorithm endpoints ─────────────────────────
  it('admin search-algorithms uses /admin/search-algorithms (no double prefix)', () => {
    expect(content).toContain('/admin/search-algorithms');
    expect(content).not.toMatch(/\/api\/v1\/admin\/search-algorithms/);
  });

  it('admin search-algorithms exposes 5 methods (list/create/update/setMandala/comparison)', () => {
    expect(content).toContain('listSearchAlgorithms');
    expect(content).toContain('createSearchAlgorithm');
    expect(content).toContain('updateSearchAlgorithm');
    expect(content).toContain('setMandalaAlgorithm');
    expect(content).toContain('getAlgorithmComparison');
  });

  it('setMandalaAlgorithm sends DELETE when override cleared, PATCH otherwise', () => {
    // The method body must reference both verbs for the null vs id branches.
    const block = content.slice(
      content.indexOf('async setMandalaAlgorithm'),
      content.indexOf('async getAlgorithmComparison')
    );
    expect(block).toContain("method: 'DELETE'");
    expect(block).toContain("method: 'PATCH'");
  });

  it('admin search-algorithms paths use encodeURIComponent for ids', () => {
    const block = content.slice(
      content.indexOf('async updateSearchAlgorithm'),
      content.indexOf('async healthCheck')
    );
    expect(block).toContain('encodeURIComponent');
  });

  it('admin pool-health uses /admin/pool-health (no double prefix)', () => {
    expect(content).toContain('/admin/pool-health');
    expect(content).not.toMatch(/\/api\/v1\/admin\/pool-health/);
  });

  it('getAdminPoolHealth exposes refresh bypass via ?refresh=1', () => {
    const block = content.slice(
      content.indexOf('async getAdminPoolHealth'),
      content.indexOf('async getAdminPoolHealth') + 400
    );
    expect(block).toContain('/admin/pool-health?refresh=1');
    expect(block).toContain('/admin/pool-health');
  });
});
