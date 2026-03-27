import { describe, it, expect } from 'vitest';
import { normalizeUrl } from '@shared/lib/url-normalize';

describe('normalizeUrl', () => {
  describe('YouTube URL normalization', () => {
    it('normalizes standard watch URL', () => {
      expect(normalizeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      );
    });

    it('normalizes watch URL with tracking params', () => {
      expect(
        normalizeUrl(
          'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLrAXtmErZgOeiKm4sgNOknGvNjby9efdf&index=2'
        )
      ).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    });

    it('normalizes youtu.be short URL', () => {
      expect(normalizeUrl('https://youtu.be/dQw4w9WgXcQ')).toBe(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      );
    });

    it('normalizes youtu.be with timestamp', () => {
      expect(normalizeUrl('https://youtu.be/dQw4w9WgXcQ?t=42')).toBe(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      );
    });

    it('normalizes mobile YouTube URL', () => {
      expect(normalizeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      );
    });

    it('preserves shorts URL format', () => {
      expect(normalizeUrl('https://www.youtube.com/shorts/abc123')).toBe(
        'https://www.youtube.com/shorts/abc123'
      );
    });

    it('normalizes mobile shorts URL', () => {
      expect(normalizeUrl('https://m.youtube.com/shorts/abc123')).toBe(
        'https://www.youtube.com/shorts/abc123'
      );
    });

    it('normalizes embed URL to watch URL', () => {
      expect(normalizeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(
        'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      );
    });

    it('returns as-is for YouTube URL without video ID', () => {
      const url = 'https://www.youtube.com/channel/UCxyz';
      expect(normalizeUrl(url)).toBe(url);
    });
  });

  describe('generic URL normalization', () => {
    it('removes UTM tracking params', () => {
      expect(
        normalizeUrl(
          'https://example.com/article?utm_source=twitter&utm_medium=social&id=42'
        )
      ).toBe('https://example.com/article?id=42');
    });

    it('removes fbclid and gclid', () => {
      expect(
        normalizeUrl('https://example.com/page?fbclid=abc123&gclid=def456')
      ).toBe('https://example.com/page');
    });

    it('sorts remaining query params', () => {
      expect(normalizeUrl('https://example.com/page?z=1&a=2')).toBe(
        'https://example.com/page?a=2&z=1'
      );
    });

    it('removes trailing slash', () => {
      expect(normalizeUrl('https://example.com/page/')).toBe(
        'https://example.com/page'
      );
    });

    it('preserves root slash', () => {
      const result = normalizeUrl('https://example.com/');
      expect(result).toBe('https://example.com/');
    });

    it('removes hash fragment', () => {
      expect(normalizeUrl('https://example.com/page#section')).toBe(
        'https://example.com/page'
      );
    });

    it('lowercases hostname', () => {
      expect(normalizeUrl('https://EXAMPLE.COM/Page')).toBe(
        'https://example.com/Page'
      );
    });
  });

  describe('edge cases', () => {
    it('returns unparseable string as-is', () => {
      expect(normalizeUrl('not-a-url')).toBe('not-a-url');
    });

    it('returns empty string as-is', () => {
      expect(normalizeUrl('')).toBe('');
    });

    it('handles URL with no path', () => {
      const result = normalizeUrl('https://example.com');
      expect(result).toContain('example.com');
    });
  });
});
