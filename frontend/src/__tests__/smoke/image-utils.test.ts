import { describe, it, expect } from 'vitest';
import {
  upgradeYouTubeThumbnail,
  getYouTubeFallback,
  handleThumbnailError,
  nextYouTubeThumbnail,
} from '@shared/lib/image-utils';

describe('upgradeYouTubeThumbnail', () => {
  it('upgrades mqdefault to maxresdefault', () => {
    expect(
      upgradeYouTubeThumbnail('https://img.youtube.com/vi/abc123/mqdefault.jpg')
    ).toBe('https://img.youtube.com/vi/abc123/maxresdefault.jpg');
  });

  it('returns non-YouTube URLs unchanged', () => {
    const url = 'https://example.com/image.jpg';
    expect(upgradeYouTubeThumbnail(url)).toBe(url);
  });

  it('returns undefined for undefined input', () => {
    expect(upgradeYouTubeThumbnail(undefined)).toBeUndefined();
  });
});

describe('getYouTubeFallback', () => {
  it('falls back maxresdefault to hqdefault', () => {
    expect(
      getYouTubeFallback('https://i.ytimg.com/vi/abc123/maxresdefault.jpg')
    ).toBe('https://i.ytimg.com/vi/abc123/hqdefault.jpg');
  });
});

describe('handleThumbnailError', () => {
  it('walks fallback chain: maxresdefault → sddefault', () => {
    const img = { src: 'https://img.youtube.com/vi/abc/maxresdefault.jpg' } as HTMLImageElement;
    handleThumbnailError({ currentTarget: img });
    expect(img.src).toBe('https://img.youtube.com/vi/abc/sddefault.jpg');
  });

  it('walks fallback chain: sddefault → hqdefault', () => {
    const img = { src: 'https://img.youtube.com/vi/abc/sddefault.jpg' } as HTMLImageElement;
    handleThumbnailError({ currentTarget: img });
    expect(img.src).toBe('https://img.youtube.com/vi/abc/hqdefault.jpg');
  });

  it('falls back to placeholder when all YouTube qualities exhausted', () => {
    const img = { src: 'https://img.youtube.com/vi/abc/default.jpg' } as HTMLImageElement;
    handleThumbnailError({ currentTarget: img });
    expect(img.src).toBe('/placeholder.svg');
  });

  it('falls back to placeholder for non-YouTube images', () => {
    const img = { src: 'https://example.com/broken.jpg' } as HTMLImageElement;
    handleThumbnailError({ currentTarget: img });
    expect(img.src).toBe('/placeholder.svg');
  });
});

describe('nextYouTubeThumbnail', () => {
  // Regression (fix/video-thumbnail): the descent must be DEEP — walk every
  // tier down to an always-present one, not stop after a single fallback.
  it('descends the full chain maxres → sd → hq → mq → default', () => {
    expect(nextYouTubeThumbnail('https://img.youtube.com/vi/abc/maxresdefault.jpg')).toBe(
      'https://img.youtube.com/vi/abc/sddefault.jpg'
    );
    expect(nextYouTubeThumbnail('https://img.youtube.com/vi/abc/sddefault.jpg')).toBe(
      'https://img.youtube.com/vi/abc/hqdefault.jpg'
    );
    expect(nextYouTubeThumbnail('https://img.youtube.com/vi/abc/hqdefault.jpg')).toBe(
      'https://img.youtube.com/vi/abc/mqdefault.jpg'
    );
    expect(nextYouTubeThumbnail('https://img.youtube.com/vi/abc/mqdefault.jpg')).toBe(
      'https://img.youtube.com/vi/abc/default.jpg'
    );
  });

  it('returns null when the chain is exhausted (default tier)', () => {
    expect(nextYouTubeThumbnail('https://img.youtube.com/vi/abc/default.jpg')).toBeNull();
  });

  it('returns null for non-YouTube / unrecognised URLs', () => {
    expect(nextYouTubeThumbnail('https://example.com/broken.jpg')).toBeNull();
  });
});
