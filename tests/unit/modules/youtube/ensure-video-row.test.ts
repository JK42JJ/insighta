/**
 * ensureYoutubeVideoRow — chokepoint that creates a missing youtube_videos row
 * (CP500+ H fix). Validates: present row → no fetch; absent row → fetch+upsert;
 * fail-open on no-key / empty lookup / errors.
 */

const findUnique = jest.fn();
const upsertVideo = jest.fn();
const videosBatchFullMetadata = jest.fn();
const resolveVideosApiKeys = jest.fn();

jest.mock('@/modules/database', () => ({
  getPrismaClient: () => ({ youtube_videos: { findUnique } }),
}));
jest.mock('@/skills/plugins/video-discover/v2/youtube-client', () => ({
  videosBatchFullMetadata: (args: unknown) => videosBatchFullMetadata(args),
  resolveVideosApiKeys: (env: unknown) => resolveVideosApiKeys(env),
}));
jest.mock('@/modules/video/manager', () => ({
  VideoManager: jest.fn().mockImplementation(() => ({ upsertVideo })),
}));

import { ensureYoutubeVideoRow } from '@/modules/youtube/ensure-video-row';

describe('ensureYoutubeVideoRow', () => {
  beforeEach(() => {
    findUnique.mockReset();
    upsertVideo.mockReset();
    videosBatchFullMetadata.mockReset();
    resolveVideosApiKeys.mockReset();
    resolveVideosApiKeys.mockReturnValue(['k']);
  });

  it('returns true and skips fetch when the row already exists', async () => {
    findUnique.mockResolvedValue({ youtube_video_id: 'v1' });
    const ok = await ensureYoutubeVideoRow('v1', {});
    expect(ok).toBe(true);
    expect(videosBatchFullMetadata).not.toHaveBeenCalled();
    expect(upsertVideo).not.toHaveBeenCalled();
  });

  it('fetches and creates the row when absent', async () => {
    findUnique.mockResolvedValue(null);
    videosBatchFullMetadata.mockResolvedValue([
      { id: 'v2', snippet: { title: 'T', channelTitle: 'C' }, contentDetails: { duration: 'PT5M' } },
    ]);
    const ok = await ensureYoutubeVideoRow('v2', {});
    expect(ok).toBe(true);
    expect(videosBatchFullMetadata).toHaveBeenCalledWith({ videoIds: ['v2'], apiKey: ['k'] });
    expect(upsertVideo).toHaveBeenCalledTimes(1);
    expect(upsertVideo.mock.calls[0][0].id).toBe('v2');
  });

  it('fails open (false) when no API key is configured', async () => {
    findUnique.mockResolvedValue(null);
    resolveVideosApiKeys.mockReturnValue([]);
    const ok = await ensureYoutubeVideoRow('v3', {});
    expect(ok).toBe(false);
    expect(videosBatchFullMetadata).not.toHaveBeenCalled();
  });

  it('fails open (false) when videos.list returns no item', async () => {
    findUnique.mockResolvedValue(null);
    videosBatchFullMetadata.mockResolvedValue([]);
    const ok = await ensureYoutubeVideoRow('v4', {});
    expect(ok).toBe(false);
    expect(upsertVideo).not.toHaveBeenCalled();
  });

  it('fails open (false) and never throws when the lookup errors', async () => {
    findUnique.mockRejectedValue(new Error('db down'));
    const ok = await ensureYoutubeVideoRow('v5', {});
    expect(ok).toBe(false);
  });
});
