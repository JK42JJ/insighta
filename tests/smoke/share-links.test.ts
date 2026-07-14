/**
 * Share v2 unit tests (2026-07-14) — the pure core of the short-link
 * backbone. Successor to guest-share.test.ts (HMAC token retired by
 * docs/design/share-v2-2026-07-14.md).
 *
 * Lesson encoded from v1: the 150-char token exceeded Fastify's default
 * maxParamLength (100) and 404'd — so URL total length is asserted here.
 */

// config/index.ts validates at import time — provide the required secret
// before the module graph loads (same pattern as llm-extract test).
process.env['ENCRYPTION_SECRET'] ??=
  'test-secret-test-secret-test-secret-test-secret-test-secret-1234';

import {
  shareLinkState,
  buildShortUrl,
  isValidCode,
  type ShareLinkRow,
} from '@/modules/share-links/manager';

const NOW = new Date('2026-07-14T12:00:00Z');

function row(overrides: Partial<ShareLinkRow> = {}): ShareLinkRow {
  return {
    id: '32680ebe-0000-4000-8000-000000000000',
    code: 'aB3xYz9k',
    target_type: 'note_episode',
    target_id: 'c01b9642-dd37-48d1-af74-5794ff1ba572',
    video_id: null,
    mode: 'guest_listen',
    expires_at: new Date(NOW.getTime() + 3600_000),
    revoked_at: null,
    created_by: 'a0000000-0000-4000-8000-000000000000',
    ...overrides,
  };
}

describe('shareLinkState', () => {
  it('valid while unexpired and unrevoked', () => {
    expect(shareLinkState(row(), NOW)).toBe('valid');
  });
  it('valid forever when expires_at is null', () => {
    expect(shareLinkState(row({ expires_at: null }), NOW)).toBe('valid');
  });
  it('expired one second past expires_at', () => {
    expect(shareLinkState(row({ expires_at: new Date(NOW.getTime() - 1000) }), NOW)).toBe(
      'expired'
    );
  });
  it('revoked wins over everything', () => {
    expect(shareLinkState(row({ revoked_at: NOW }), NOW)).toBe('revoked');
  });
  it('unknown for a missing row', () => {
    expect(shareLinkState(null, NOW)).toBe('unknown');
  });
});

describe('buildShortUrl — commercial-grade URL', () => {
  it('stays one-chat-line short (< 40 chars total)', () => {
    const url = buildShortUrl('aB3xYz9k');
    expect(url).toBe('https://insighta.one/s/aB3xYz9k');
    expect(url.length).toBeLessThan(40);
  });
});

describe('isValidCode — resolver input gate', () => {
  it('accepts an 8-char unambiguous-alphabet code', () => {
    expect(isValidCode('aB3xYz9k')).toBe(true);
  });
  it('rejects wrong length, ambiguous chars, and the v1 token shape', () => {
    expect(isValidCode('short')).toBe(false);
    expect(isValidCode('aB3xYz9kX')).toBe(false);
    expect(isValidCode('aB3xYz0O')).toBe(false); // 0/O excluded from alphabet
    expect(isValidCode('g1.eyJtIjoiYzAx.sig')).toBe(false);
    expect(isValidCode('')).toBe(false);
  });
});
