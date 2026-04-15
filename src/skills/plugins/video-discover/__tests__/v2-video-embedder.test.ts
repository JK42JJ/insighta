/**
 * v2 video-embedder — unit tests
 *
 * Mocks Ollama via fetchImpl. No real network.
 */

import {
  buildEmbeddingText,
  embedVideos,
  MAX_EMBED_TEXT_LENGTH,
  type VideoForEmbedding,
} from '../v2/video-embedder';

const DIM = 4096;

function fakeVector(seed: number): number[] {
  const v = new Array(DIM).fill(0);
  v[seed % DIM] = 1;
  return v;
}

describe('buildEmbeddingText', () => {
  test('title only when description missing', () => {
    expect(buildEmbeddingText({ videoId: 'a', title: 'Hello world' })).toBe('Hello world');
  });

  test('title + description joined and truncated', () => {
    const text = buildEmbeddingText({
      videoId: 'a',
      title: 'Title',
      description: 'd'.repeat(1000),
    });
    expect(text.length).toBeLessThanOrEqual(MAX_EMBED_TEXT_LENGTH);
    expect(text.startsWith('Title.')).toBe(true);
  });

  test('whitespace collapsed', () => {
    const text = buildEmbeddingText({
      videoId: 'a',
      title: 'A',
      description: 'b   c\n\nd',
    });
    expect(text).toBe('A. b c d');
  });

  test('empty title and description returns empty string', () => {
    expect(buildEmbeddingText({ videoId: 'a', title: '', description: '' })).toBe('');
  });
});

describe('embedVideos', () => {
  function mockHealthOk(): typeof fetch {
    return (async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/tags')) {
        return { ok: true, status: 200 } as unknown as Response;
      }
      // /api/embed
      return {
        ok: true,
        status: 200,
        text: async () => '',
        json: async () => ({
          embeddings: [fakeVector(1), fakeVector(2)],
        }),
      } as unknown as Response;
    }) as unknown as typeof fetch;
  }

  test('returns embeddings when Ollama healthy', async () => {
    const videos: VideoForEmbedding[] = [
      { videoId: 'v1', title: 'Title 1' },
      { videoId: 'v2', title: 'Title 2' },
    ];
    const result = await embedVideos(videos, { fetchImpl: mockHealthOk() });
    expect(result.ollamaReachable).toBe(true);
    expect(result.embeddedCount).toBe(2);
    expect(result.embeddings.size).toBe(2);
  });

  test('returns empty + ollamaReachable=false when health probe fails', async () => {
    const fetchImpl: typeof fetch = (async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/tags')) {
        return { ok: false, status: 500 } as unknown as Response;
      }
      throw new Error('embed should not be called');
    }) as unknown as typeof fetch;

    const result = await embedVideos([{ videoId: 'v1', title: 'x' }], { fetchImpl });
    expect(result.ollamaReachable).toBe(false);
    expect(result.embeddings.size).toBe(0);
  });

  test('empty input returns empty result without network', async () => {
    let called = 0;
    const fetchImpl = (async () => {
      called++;
      return {} as Response;
    }) as unknown as typeof fetch;
    const result = await embedVideos([], { fetchImpl });
    expect(called).toBe(0);
    expect(result.embeddedCount).toBe(0);
  });

  test('embedBatch failure degrades silently', async () => {
    const fetchImpl: typeof fetch = (async (url: string) => {
      if (typeof url === 'string' && url.includes('/api/tags')) {
        return { ok: true, status: 200 } as unknown as Response;
      }
      return {
        ok: false,
        status: 500,
        text: async () => 'embed crashed',
        json: async () => ({}),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    const result = await embedVideos([{ videoId: 'v1', title: 'x' }], { fetchImpl });
    expect(result.ollamaReachable).toBe(true);
    expect(result.embeddedCount).toBe(0);
  });
});
