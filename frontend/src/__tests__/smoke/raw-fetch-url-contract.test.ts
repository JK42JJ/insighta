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
