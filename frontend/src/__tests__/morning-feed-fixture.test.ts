import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cssText } from '@/features/morning-feed/css-text';

const sha = (p: string) =>
  createHash('sha256')
    .update(readFileSync(resolve(__dirname, p)))
    .digest('hex');

describe('morning feed fixture', () => {
  it('the in-app fixture is byte-identical to the delivered test fixture', () => {
    expect(sha('../features/morning-feed/morning-feed.fixture.json')).toBe(
      sha('../../tests/morning-feed/fixtures/morning-feed.fixture.json')
    );
  });
});

describe('cssText', () => {
  it('parses plain, vendor-prefixed and custom-property declarations', () => {
    expect(cssText('font-size: 14px; -webkit-backdrop-filter: blur(20px); --x: 1')).toEqual({
      fontSize: '14px',
      WebkitBackdropFilter: 'blur(20px)',
      '--x': '1',
    });
  });

  it('keeps values that contain commas and function calls', () => {
    expect(cssText('transition: transform 0.2s cubic-bezier(.34,1.4,.64,1)')).toEqual({
      transition: 'transform 0.2s cubic-bezier(.34,1.4,.64,1)',
    });
  });
});
