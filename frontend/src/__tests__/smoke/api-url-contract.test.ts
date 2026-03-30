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
});
