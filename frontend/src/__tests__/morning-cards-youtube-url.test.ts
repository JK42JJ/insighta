import { describe, it, expect } from 'vitest';
import {
  buildYoutubeWatchUrl,
  buildYoutubeEmbedUrl,
  isValidYoutubeVideoId,
} from '@/features/morning-cards/youtube-url';

describe('morning cards youtube url', () => {
  it('builds youtube.com urls for a valid id', () => {
    expect(buildYoutubeWatchUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
    expect(buildYoutubeEmbedUrl('dQw4w9WgXcQ')).toBe('https://www.youtube.com/embed/dQw4w9WgXcQ');
  });

  it('returns null for invalid ids', () => {
    for (const bad of ['', 'short', 'dQw4w9WgXcQ12', 'dQw4w9WgXc"', '<script>aaa', null, 42]) {
      expect(buildYoutubeWatchUrl(bad)).toBeNull();
      expect(buildYoutubeEmbedUrl(bad)).toBeNull();
      expect(isValidYoutubeVideoId(bad)).toBe(false);
    }
  });
});
