import { readFileSync } from 'fs';
import { join } from 'path';
import { morningCardsRoutes } from '@/api/routes/morning-cards';

export {};

const SERVER_SOURCE = readFileSync(join(__dirname, '../../src/api/server.ts'), 'utf8');

describe('morning cards route registration', () => {
  it('exports the plugin as a function', () => {
    expect(typeof morningCardsRoutes).toBe('function');
  });

  it('registers the plugin once under the morning-cards prefix in server.ts', () => {
    const matches = SERVER_SOURCE.match(
      /instance\.register\(morningCardsRoutes,\s*\{\s*prefix:\s*'\/morning-cards'\s*\}\)/g
    );
    expect(matches).toHaveLength(1);
  });
});
