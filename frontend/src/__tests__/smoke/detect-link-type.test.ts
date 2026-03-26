import { describe, it, expect } from 'vitest';
import { detectLinkType } from '@shared/data/mockData';

describe('detectLinkType', () => {
  it('classifies youtube.com/watch as youtube', () => {
    expect(detectLinkType('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe('youtube');
  });

  it('classifies youtu.be short links as youtube', () => {
    expect(detectLinkType('https://youtu.be/dQw4w9WgXcQ')).toBe('youtube');
  });

  it('does NOT classify img.youtube.com as youtube (CDN host)', () => {
    const result = detectLinkType('https://img.youtube.com/vi/abc/mqdefault.jpg');
    expect(result).not.toBe('youtube');
    expect(result).toBe('other');
  });

  it('does NOT classify i.ytimg.com as youtube (CDN host)', () => {
    expect(detectLinkType('https://i.ytimg.com/vi/abc/hqdefault.jpg')).toBe('other');
  });

  it('classifies youtube.com/shorts as youtube-shorts', () => {
    expect(detectLinkType('https://www.youtube.com/shorts/abc123')).toBe('youtube-shorts');
  });

  it('classifies youtube.com/playlist as youtube-playlist', () => {
    expect(detectLinkType('https://www.youtube.com/playlist?list=PLxxx')).toBe('youtube-playlist');
  });

  it('classifies linkedin.com as linkedin', () => {
    expect(detectLinkType('https://www.linkedin.com/post/some-post')).toBe('linkedin');
  });

  it('classifies facebook.com as facebook', () => {
    expect(detectLinkType('https://www.facebook.com/post/123')).toBe('facebook');
  });

  it('classifies .pdf as pdf', () => {
    expect(detectLinkType('https://example.com/research.pdf')).toBe('pdf');
  });

  it('classifies unknown URLs as other', () => {
    expect(detectLinkType('https://example.com/page')).toBe('other');
  });
});
