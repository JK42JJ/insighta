import { describe, it, expect } from 'vitest';

describe('App module smoke tests', () => {
  it('App exports a default function (React component)', async () => {
    // Dynamic import to avoid side-effect crashes at module level
    // This verifies the module parses and exports correctly
    const module = await import('@app/App');
    expect(module.default).toBeDefined();
    expect(typeof module.default).toBe('function');
  });
});

describe('Critical shared modules are importable', () => {
  it('card-validation module exports isValidCardForInsert', async () => {
    const module = await import('@shared/lib/card-validation');
    expect(module.isValidCardForInsert).toBeDefined();
    expect(typeof module.isValidCardForInsert).toBe('function');
  });

  it('mockData module exports detectLinkType', async () => {
    const module = await import('@shared/data/mockData');
    expect(module.detectLinkType).toBeDefined();
    expect(typeof module.detectLinkType).toBe('function');
  });
});
