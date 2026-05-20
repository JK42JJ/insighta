/**
 * Unit tests for `sanitizeLogUrl` (CP475+7 — JWT log leak fix).
 *
 * The function must mask any value belonging to an auth-bearing query
 * parameter while leaving the rest of the URL intact.
 */

import { sanitizeLogUrl } from '@/api/utils/log-url-sanitizer';

describe('sanitizeLogUrl', () => {
  describe('redacts sensitive query params', () => {
    it('masks access_token value (the CP475+7 primary case)', () => {
      const url =
        '/api/v1/mandalas/abc/videos/stream?access_token=eyJhbGciOiJFUzI1NiIsImtpZCI6IjRhOWUxM2ZjIn0.long_jwt_body.signature';
      expect(sanitizeLogUrl(url)).toBe(
        '/api/v1/mandalas/abc/videos/stream?access_token=<redacted>'
      );
    });

    it('masks token value', () => {
      expect(sanitizeLogUrl('/x?token=abcdef123')).toBe('/x?token=<redacted>');
    });

    it('masks api_key value', () => {
      expect(sanitizeLogUrl('/y?api_key=AIzaSyD-abc')).toBe('/y?api_key=<redacted>');
    });

    it('masks id_token and refresh_token values', () => {
      expect(sanitizeLogUrl('/z?id_token=foo&refresh_token=bar')).toBe(
        '/z?id_token=<redacted>&refresh_token=<redacted>'
      );
    });

    it('is case-insensitive on param name', () => {
      expect(sanitizeLogUrl('/x?Access_Token=eyJ.h')).toBe('/x?Access_Token=<redacted>');
    });
  });

  describe('preserves non-sensitive params', () => {
    it('leaves lastEventId untouched while masking access_token', () => {
      const url = '/api/v1/mandalas/m1/videos/stream?access_token=eyJ.x.y&lastEventId=42';
      expect(sanitizeLogUrl(url)).toBe(
        '/api/v1/mandalas/m1/videos/stream?access_token=<redacted>&lastEventId=42'
      );
    });

    it('leaves a URL with no sensitive params unchanged', () => {
      const url = '/api/v1/cards?cursor=abc&limit=20';
      expect(sanitizeLogUrl(url)).toBe(url);
    });

    it('leaves a URL with no query string unchanged', () => {
      expect(sanitizeLogUrl('/api/v1/health')).toBe('/api/v1/health');
    });
  });

  describe('edge cases', () => {
    it('handles undefined gracefully', () => {
      expect(sanitizeLogUrl(undefined)).toBe('');
    });

    it('handles null gracefully', () => {
      expect(sanitizeLogUrl(null)).toBe('');
    });

    it('handles empty string gracefully', () => {
      expect(sanitizeLogUrl('')).toBe('');
    });

    it('does NOT mask param values that merely START with a sensitive name (e.g. access_token_hint)', () => {
      // The regex matches the param name as a discrete token (boundary before `=`).
      // `access_token_hint=foo` is a different key → must NOT be masked.
      expect(sanitizeLogUrl('/x?access_token_hint=public_value')).toBe(
        '/x?access_token_hint=public_value'
      );
    });

    it('masks across hash fragments correctly (stops at #)', () => {
      // `#` ends the query string; the hash fragment is not part of params.
      expect(sanitizeLogUrl('/x?access_token=secret#section')).toBe(
        '/x?access_token=<redacted>#section'
      );
    });
  });
});
