/**
 * The brief branch in rewriteSystemContent.
 *
 * The branch must (1) return the brief prompt when the marker is present and
 * the issue is readable, (2) fall through to the ordinary path when the issue
 * is not readable, and (3) never load or call the brief module for any other
 * request. (3) is what keeps the learning page's chat on the path it had
 * before. The existing middleware suite runs unchanged next to this file.
 */

const mockLoadVideoContext = jest.fn();
const mockBuildBriefSystemContent = jest.fn();

jest.mock('@/utils/logger', () => {
  const child = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: () => child,
  };
  return { logger: child };
});

jest.mock('@/modules/chatbot-rag/video-context-loader', () => ({
  loadVideoContext: mockLoadVideoContext,
}));

jest.mock('@/modules/chatbot-rag/brief-prompt', () => ({
  buildBriefSystemContent: mockBuildBriefSystemContent,
}));

import {
  rewriteSystemContent,
  _resetMiddlewareCacheForTesting,
} from '@/modules/chatbot-rag/qwen-prompt-middleware';

const SLUG = '2026-09-02-ai-tech';
const BRIEF_PROMPT = '[Insighta 소개]\n...\n[이번 호 브리프]\n...\n[브리프 답변 규칙]';

beforeEach(() => {
  jest.clearAllMocks();
  _resetMiddlewareCacheForTesting();
  mockLoadVideoContext.mockResolvedValue({ v2Data: null, transcript: null });
});

describe('rewriteSystemContent — brief branch', () => {
  it('returns the brief prompt for a marked conversation and skips the video path', async () => {
    mockBuildBriefSystemContent.mockResolvedValue(BRIEF_PROMPT);
    const out = await rewriteSystemContent(
      `[[brief:${SLUG}]]\n이 대화는 AI 엔지니어링 제1호 브리프에 대한 질문입니다.`
    );
    expect(out).toBe(BRIEF_PROMPT);
    expect(mockBuildBriefSystemContent).toHaveBeenCalledTimes(1);
    expect(mockLoadVideoContext).not.toHaveBeenCalled();
  });

  it('falls through to the ordinary prompt when the issue is not readable', async () => {
    mockBuildBriefSystemContent.mockResolvedValue(null);
    const out = await rewriteSystemContent(`[[brief:${SLUG}]]`);
    expect(mockBuildBriefSystemContent).toHaveBeenCalledTimes(1);
    expect(out).not.toBe(BRIEF_PROMPT);
    expect(out).toContain('[Insighta 소개]');
  });

  it('never calls the brief module for a learning-page conversation', async () => {
    const learning = await rewriteSystemContent(
      '## Current Video\n- URL: https://www.youtube.com/watch?v=abcdefghijk\n이 영상에 대해 답하세요'
    );
    expect(mockBuildBriefSystemContent).not.toHaveBeenCalled();
    expect(learning).toContain('[Insighta 소개]');
  });
});
