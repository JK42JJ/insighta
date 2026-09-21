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

  // CP499 #3 — A-stage relevance trigger (user-facing twin of rich-summary-trigger).
  it('triggerMandalaRelevance posts /mandalas/:id/relevance-trigger (no double prefix)', () => {
    expect(content).toContain('/mandalas/${mandalaId}/relevance-trigger');
    expect(content).not.toMatch(/\/api\/v1\/mandalas\/\$\{mandalaId\}\/relevance-trigger/);
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

  it('admin pool-health detail uses /admin/pool-health/details/:metric (no double prefix)', () => {
    expect(content).toContain('/admin/pool-health/details/');
    expect(content).not.toMatch(/\/api\/v1\/admin\/pool-health\/details/);
  });

  it('getAdminPoolHealthDetail encodes metric path segment', () => {
    const block = content.slice(
      content.indexOf('async getAdminPoolHealthDetail'),
      content.indexOf('async getAdminPoolHealthDetail') + 400
    );
    expect(block).toContain('encodeURIComponent');
  });

  /**
   * Raw-fetch methods bypass request(), so the checks above do not see them.
   * This one is here because it replaced a `<a href>` that put the JWT in the
   * query string: the credential must travel as a header, and nothing in this
   * client may reintroduce `?access_token=` on a non-stream route.
   */
  describe('getNewsletterIssuePreview', () => {
    const block = content.slice(
      content.indexOf('async getNewsletterIssuePreview'),
      content.indexOf('async getNewsletterIssuePreview') + 900
    );

    it('exists and builds the admin preview url with a single /api/v1', () => {
      expect(block).toContain('/api/v1/admin/newsletter/issues/');
      expect(block).toContain('/preview');
      expect(block).not.toContain('/api/v1/api/v1');
    });

    it('sends the token as an Authorization header, never in the url', () => {
      expect(block).toContain('Authorization: `Bearer ${token}`');
      expect(block).not.toContain('access_token');
    });

    it('encodes the id', () => {
      expect(block).toContain('encodeURIComponent(id)');
    });
  });

  it('keeps ?access_token= to the two EventSource streams', () => {
    // EventSource cannot set a header; nothing else in the client has that
    // excuse, and the server now refuses a query token off those two routes.
    const code = content
      .split('\n')
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .filter((l) => l.includes('access_token='));
    expect(code).toEqual([]);
  });
});
