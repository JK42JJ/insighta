/**
 * Raw Fetch URL Contract Test
 *
 * Catches the "/api/api/v1/..." double-prefix bug seen in prod (CP450) where
 * useSummaryRating.ts built `${VITE_API_URL}/api/v1/...` while prod sets
 * `VITE_API_URL=/api`. Any file using raw `fetch(${VITE_API_URL}/api/v1/...)`
 * MUST first normalize the base URL the same way api-client.ts does:
 *   const API_BASE_URL = url.endsWith('/api') ? url.slice(0, -4) : url;
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { globSync } from 'glob';

const ROOT = path.resolve(__dirname, '../..');

function listSourceFiles(): string[] {
  return globSync('**/*.{ts,tsx}', {
    cwd: ROOT,
    ignore: ['__tests__/**', 'shared/lib/api-client.ts', 'app/**', '**/*.d.ts'],
    absolute: true,
  });
}

describe('Raw fetch URL contract (no double /api prefix)', () => {
  it('every file that concatenates VITE_API_URL with /api/v1 also normalizes', () => {
    const files = listSourceFiles();
    const violations: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      // Look for the dangerous pattern: ${...VITE_API_URL...}/api/...
      const hasRawConcatToApi = /\$\{[^}]*VITE_API_URL[^}]*\}\/api\//.test(content);
      if (!hasRawConcatToApi) continue;

      const hasNormalization =
        content.includes("endsWith('/api')") || content.includes('endsWith("/api")');

      if (!hasNormalization) {
        violations.push(path.relative(ROOT, file));
      }
    }

    expect(violations).toEqual([]);
  });
});

// Graph data hook bypasses api-client methods (private request()) with its own
// authed fetch — pin its URL construction to the BE route contract
// (src/api/routes/ontology.ts GET /subgraph + SubgraphQuerySchema.mandala_id).
describe('Ontology raw-fetch URL contract (useGraphData)', () => {
  const HOOK_PATH = path.resolve(ROOT, 'components/graph/useGraphData.ts');
  const content = fs.readFileSync(HOOK_PATH, 'utf-8');

  it('builds URLs from the normalized apiClient baseUrl, not VITE_API_URL', () => {
    expect(content).not.toContain('VITE_API_URL');
    expect(content).toContain('apiClient');
    expect(content).toContain('${baseUrl}/api/v1/ontology${endpoint}');
  });

  it('endpoints carry no /api prefix of their own (single-prefix invariant)', () => {
    const endpoints = [...content.matchAll(/fetchWithAuth\(\s*[`'"]([^`'"]+)/g)].map((m) => m[1]);
    expect(endpoints.length).toBeGreaterThanOrEqual(3); // nodes, subgraph, stats
    for (const endpoint of endpoints) {
      expect(endpoint.startsWith('/')).toBe(true);
      expect(endpoint.startsWith('/api')).toBe(false);
    }
  });

  it('user graph call matches the BE route (user-wide /subgraph, no scope param)', () => {
    expect(content).toContain("fetchWithAuth('/subgraph')");
  });
});

// The morning feed client has its own call(): pin the comment route to the BE route it posts to.
describe('Morning feed comment URL contract (POST /morning-feed/app-feedback)', () => {
  const client = fs.readFileSync(path.resolve(ROOT, 'features/morning-cards/api.ts'), 'utf-8');
  const route = fs.readFileSync(
    path.resolve(ROOT, '../../src/api/routes/morning-feed.ts'),
    'utf-8'
  );
  const block = client.slice(client.indexOf('export async function postAppFeedback'));

  it('posts to the path the server registers, with a single /api/v1', () => {
    expect(client).toContain("const MORNING_FEED_PATH = '/api/v1/morning-feed'");
    expect(block).toMatch(/'\/app-feedback',\s*\{ method: 'POST'/);
    expect(block).toContain('MORNING_FEED_PATH');
    expect(block).not.toContain('/api/v1');
    expect(route).toMatch(/fastify\.post\(\s*'\/app-feedback'/);
  });
});
