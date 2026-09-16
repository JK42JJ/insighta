/**
 * tests/unit/modules/chatbot-rag/video-context-loader.test.ts
 *
 * Unit tests for the chatbot video grounding decision (CP474 Phase B).
 *
 * Coverage:
 *   - summaryHasUsableContent: 8 scenarios (FE↔BE mirror invariant)
 *   - loadVideoContext: v2 happy path → V2Summary returned
 *   - loadVideoContext: v2 absent → transcript fallback engaged
 *   - loadVideoContext: v2 not usable (empty core/analysis) → transcript fallback
 *   - loadVideoContext: v2 quality_flag='low' → treated as absent
 *   - loadVideoContext: both branches fail → { v2Data: null, transcript: null }
 *   - loadVideoContext: transcript truncation at TRANSCRIPT_PROMPT_MAX_CHARS
 *   - loadVideoContext: youtube_videos title JOIN failure → V2Summary with title=null
 *
 * Mocks: Prisma client + caption extractor singleton.
 */

const mockV2FindUnique = jest.fn();
const mockYoutubeVideosFindUnique = jest.fn();
const mockExtractCaptions = jest.fn();

// Mock logger first — its module imports `@/config/index` which validates env
// vars (ENCRYPTION_SECRET etc.). Mocking the logger keeps the test purely unit.
jest.mock('@/utils/logger', () => {
  type Logger = {
    info: jest.Mock;
    warn: jest.Mock;
    error: jest.Mock;
    debug: jest.Mock;
    child: () => Logger;
  };
  const childLogger: Logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: () => childLogger,
  };
  return { logger: childLogger };
});

jest.mock('@/modules/database/client', () => ({
  getPrismaClient: () => ({
    video_rich_summaries: { findUnique: mockV2FindUnique },
    youtube_videos: { findUnique: mockYoutubeVideosFindUnique },
  }),
}));

jest.mock('@/modules/caption/extractor', () => ({
  getCaptionExtractor: () => ({
    extractCaptions: mockExtractCaptions,
  }),
}));

import {
  loadVideoContext,
  summaryHasUsableContent,
} from '@/modules/chatbot-rag/video-context-loader';
import { TRANSCRIPT_PROMPT_MAX_CHARS } from '@/modules/chatbot-rag/types';

beforeEach(() => {
  jest.clearAllMocks();
  // Default success-shaped responses; individual tests override as needed.
  mockYoutubeVideosFindUnique.mockResolvedValue({ title: '하프 1:30의 벽' });
  mockExtractCaptions.mockResolvedValue({
    success: false,
    videoId: 'abc123',
    language: 'ko',
    error: 'No publicly available captions found',
  });
});

describe('summaryHasUsableContent — FE/BE mirror invariant', () => {
  it('returns true when core.one_liner present', () => {
    expect(
      summaryHasUsableContent({
        core: { one_liner: '핵심 한 줄' },
      })
    ).toBe(true);
  });

  it('returns true when analysis.core_argument present', () => {
    expect(
      summaryHasUsableContent({
        analysis: { core_argument: '주장' },
      })
    ).toBe(true);
  });

  it('returns true when analysis.key_concepts has items', () => {
    expect(
      summaryHasUsableContent({
        analysis: { key_concepts: [{ term: 't', definition: 'd' }] },
      })
    ).toBe(true);
  });

  it('returns true when analysis.actionables has items', () => {
    expect(
      summaryHasUsableContent({
        analysis: { actionables: ['a'] },
      })
    ).toBe(true);
  });

  it('returns true when v1 oneLiner present', () => {
    expect(summaryHasUsableContent({ oneLiner: '한 줄' })).toBe(true);
  });

  it('returns true when v1 structured.core_argument present', () => {
    expect(
      summaryHasUsableContent({
        structured: { core_argument: 'v1 주장' },
      })
    ).toBe(true);
  });

  it('returns true when v1 structured.key_points has items', () => {
    expect(
      summaryHasUsableContent({
        structured: { key_points: ['a'] },
      })
    ).toBe(true);
  });

  it('returns false when all fields empty / absent', () => {
    expect(summaryHasUsableContent({})).toBe(false);
    expect(
      summaryHasUsableContent({
        core: { one_liner: '' },
        analysis: { core_argument: '', key_concepts: [], actionables: [] },
        structured: { core_argument: '', key_points: [], actionables: [] },
      })
    ).toBe(false);
  });
});

describe('loadVideoContext — v2 path', () => {
  it('returns V2Summary when v2 row is usable', async () => {
    mockV2FindUnique.mockResolvedValueOnce({
      one_liner: null,
      structured: null,
      core: { one_liner: '핵심 한 줄', domain: 'running' },
      analysis: { core_argument: '주장', key_concepts: [], actionables: [] },
      segments: { sections: [] },
      quality_flag: 'pass',
      template_version: 'v2',
    });

    const result = await loadVideoContext({ youtubeVideoId: 'abc12345678' });

    expect(result.v2Data).not.toBeNull();
    expect(result.v2Data?.title).toBe('하프 1:30의 벽');
    expect(result.v2Data?.core).toMatchObject({ one_liner: '핵심 한 줄' });
    expect(result.transcript).toBeNull();
    // Transcript extractor must not run when v2 wins.
    expect(mockExtractCaptions).not.toHaveBeenCalled();
  });

  it('returns V2Summary with title=null when youtube_videos JOIN fails', async () => {
    mockV2FindUnique.mockResolvedValueOnce({
      one_liner: null,
      core: { one_liner: '핵심' },
      analysis: null,
      segments: null,
      quality_flag: 'pass',
      template_version: 'v2',
    });
    mockYoutubeVideosFindUnique.mockRejectedValueOnce(new Error('db down'));

    const result = await loadVideoContext({ youtubeVideoId: 'abc12345678' });

    expect(result.v2Data?.title).toBeNull();
    expect(result.v2Data?.core).toMatchObject({ one_liner: '핵심' });
  });

  it('treats quality_flag="low" as absent and falls back to transcript', async () => {
    mockV2FindUnique.mockResolvedValueOnce({
      one_liner: '한 줄',
      core: { one_liner: '한 줄' },
      analysis: null,
      segments: null,
      quality_flag: 'low',
      template_version: 'v2',
    });
    mockExtractCaptions.mockResolvedValueOnce({
      success: true,
      videoId: 'abc12345678',
      language: 'ko',
      caption: { videoId: 'abc12345678', language: 'ko', fullText: '자막 내용', segments: [] },
    });

    const result = await loadVideoContext({ youtubeVideoId: 'abc12345678' });

    expect(result.v2Data).toBeNull();
    expect(result.transcript?.full_text).toBe('자막 내용');
  });

  it('falls back to transcript when v2 row has all-empty content', async () => {
    mockV2FindUnique.mockResolvedValueOnce({
      one_liner: null,
      core: { one_liner: '' },
      analysis: { core_argument: '', key_concepts: [], actionables: [] },
      segments: null,
      quality_flag: 'pass',
      template_version: 'v2',
      structured: null,
    });
    mockExtractCaptions.mockResolvedValueOnce({
      success: true,
      videoId: 'abc12345678',
      language: 'en',
      caption: { videoId: 'abc12345678', language: 'en', fullText: 'transcript', segments: [] },
    });

    const result = await loadVideoContext({ youtubeVideoId: 'abc12345678' });

    expect(result.v2Data).toBeNull();
    expect(result.transcript?.full_text).toBe('transcript');
    expect(result.transcript?.language).toBe('en');
  });
});

describe('loadVideoContext — transcript fallback', () => {
  it('returns transcript when v2 row is absent and caption extractor succeeds', async () => {
    mockV2FindUnique.mockResolvedValueOnce(null);
    mockExtractCaptions.mockResolvedValueOnce({
      success: true,
      videoId: 'abc12345678',
      language: 'ko',
      caption: { videoId: 'abc12345678', language: 'ko', fullText: '안녕하세요', segments: [] },
    });

    const result = await loadVideoContext({ youtubeVideoId: 'abc12345678' });

    expect(result.v2Data).toBeNull();
    expect(result.transcript).toMatchObject({
      full_text: '안녕하세요',
      language: 'ko',
      truncated: false,
      total_chars: 5,
    });
  });

  it('truncates transcript to TRANSCRIPT_PROMPT_MAX_CHARS when oversized', async () => {
    mockV2FindUnique.mockResolvedValueOnce(null);
    const huge = '가'.repeat(TRANSCRIPT_PROMPT_MAX_CHARS + 500);
    mockExtractCaptions.mockResolvedValueOnce({
      success: true,
      videoId: 'abc12345678',
      language: 'ko',
      caption: { videoId: 'abc12345678', language: 'ko', fullText: huge, segments: [] },
    });

    const result = await loadVideoContext({ youtubeVideoId: 'abc12345678' });

    expect(result.transcript?.truncated).toBe(true);
    expect(result.transcript?.full_text.length).toBe(TRANSCRIPT_PROMPT_MAX_CHARS);
    expect(result.transcript?.total_chars).toBe(TRANSCRIPT_PROMPT_MAX_CHARS + 500);
  });

  it('returns both null when v2 absent AND transcript fetch fails', async () => {
    mockV2FindUnique.mockResolvedValueOnce(null);
    // default mockExtractCaptions returns success:false (set in beforeEach)

    const result = await loadVideoContext({ youtubeVideoId: 'abc12345678' });

    expect(result.v2Data).toBeNull();
    expect(result.transcript).toBeNull();
  });

  it('returns both null when v2 lookup throws AND transcript fetch throws', async () => {
    mockV2FindUnique.mockRejectedValueOnce(new Error('db down'));
    mockExtractCaptions.mockRejectedValueOnce(new Error('mac mini timeout'));

    const result = await loadVideoContext({ youtubeVideoId: 'abc12345678' });

    expect(result.v2Data).toBeNull();
    expect(result.transcript).toBeNull();
  });
});
