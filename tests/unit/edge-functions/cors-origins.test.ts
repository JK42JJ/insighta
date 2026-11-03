/**
 * The four browser-facing Edge Functions each carry their own copy of the
 * origin allow-list (a deployed function cannot import from the repo). A
 * browser at an origin missing from the list gets the first entry back and
 * blocks the response, so a list that drifted from the others shows up as an
 * empty card grid on that origin and nothing else.
 *
 * stg.insighta.one was missing from all four, which left the staging card list
 * empty with the cards present in the database (2026-11-04).
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const FUNCTIONS = ['local-cards', 'youtube-sync', 'youtube-auth', 'fetch-url-metadata'];

const EXPECTED_ORIGINS = [
  'https://insighta.one',
  'https://www.insighta.one',
  'https://stg.insighta.one',
  'http://localhost:8081',
  'http://localhost:5173',
];

function readAllowedOrigins(fn: string): string[] {
  const src = readFileSync(join(__dirname, '../../../supabase/functions', fn, 'index.ts'), 'utf8');
  const m = /const ALLOWED_ORIGINS = \[([\s\S]*?)\];/.exec(src);
  if (!m || m[1] === undefined) throw new Error(`${fn}: ALLOWED_ORIGINS list not found`);
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1] as string);
}

describe('Edge Function CORS origin allow-lists', () => {
  it.each(FUNCTIONS)('%s allows every origin the web app is served from', (fn) => {
    expect(readAllowedOrigins(fn)).toEqual(EXPECTED_ORIGINS);
  });

  it('keeps the production origin first, since it is the fallback for unknown origins', () => {
    for (const fn of FUNCTIONS) {
      expect(readAllowedOrigins(fn)[0]).toBe('https://insighta.one');
    }
  });
});
