/**
 * tests/unit/modules/chatbot-rag/qwen-prompt-middleware.test.ts
 *
 * Unit tests for the qwen prompt middleware (CP474 Stage 7a).
 *
 * Coverage:
 *   - rewriteSystemContent extracts video_id from YouTube URL
 *   - rewriteSystemContent passes v2 / transcript through to prompt-builder
 *   - Korean vs English detection
 *   - Cache: second call for same videoId reuses loaded context
 *   - Cache invalidates after TTL (5min)
 *   - rewriteSystemPrompt (V3 form) keeps non-system messages in order
 *   - rewriteSystemPrompt with empty prompt returns null
 *   - createQwenPromptMiddleware transformParams handles errors fail-safe
 */

const mockLoadVideoContext = jest.fn();

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

jest.mock('@/modules/chatbot-rag/video-context-loader', () => ({
  loadVideoContext: mockLoadVideoContext,
}));

import {
  rewriteSystemContent,
  rewriteSystemPrompt,
  createQwenPromptMiddleware,
  _resetMiddlewareCacheForTesting,
} from '@/modules/chatbot-rag/qwen-prompt-middleware';
import { PRODUCT_PERSONA_KO, PRODUCT_PERSONA_EN } from '@/modules/chatbot-rag/prompt-builder';

const SAMPLE_V2 = {
  title: '하프 1:30의 벽',
  core: { one_liner: '속도/지구력/회복', domain: 'running' },
  analysis: { core_argument: '균형 잡힌 훈련' },
};

const SAMPLE_TRANSCRIPT = {
  full_text: '안녕하세요',
  source: 'mac-mini' as const,
  language: 'ko' as const,
  truncated: false,
  total_chars: 5,
};

beforeEach(() => {
  jest.clearAllMocks();
  _resetMiddlewareCacheForTesting();
  // Default: no v2, no transcript — keeps tests deterministic
  mockLoadVideoContext.mockResolvedValue({ v2Data: null, transcript: null });
});

describe('rewriteSystemContent', () => {
  it('parses video_id from a YouTube URL and forwards it to loadVideoContext', async () => {
    await rewriteSystemContent('URL: https://www.youtube.com/watch?v=abc12345678 something');

    expect(mockLoadVideoContext).toHaveBeenCalledWith({
      youtubeVideoId: 'abc12345678',
      preferredLanguage: 'ko',
    });
  });

  it('omits loadVideoContext entirely when no YouTube URL is present', async () => {
    await rewriteSystemContent('한국어 일반 응답 요청 — 영상 없음');

    expect(mockLoadVideoContext).not.toHaveBeenCalled();
  });

  it('passes loaded v2 data into the system prompt', async () => {
    mockLoadVideoContext.mockResolvedValueOnce({ v2Data: SAMPLE_V2, transcript: null });

    const out = await rewriteSystemContent('URL: https://www.youtube.com/watch?v=abc12345678');

    expect(out).toContain('[영상 정보]');
    expect(out).toContain('제목: 하프 1:30의 벽');
    expect(out).toContain('핵심 주장: 속도/지구력/회복');
  });

  it('engages the transcript fallback when no v2', async () => {
    mockLoadVideoContext.mockResolvedValueOnce({ v2Data: null, transcript: SAMPLE_TRANSCRIPT });

    const out = await rewriteSystemContent('URL: https://www.youtube.com/watch?v=abc12345678');

    expect(out).toContain('출처: mac-mini');
    expect(out).toContain('안녕하세요');
    // v2-only block markers (NOT referenced in EXTENDED_RULES_KO) must be absent.
    expect(out).not.toContain('제목:');
    expect(out).not.toContain('[핵심 개념]');
  });

  it('always prepends the Korean persona block by default', async () => {
    const out = await rewriteSystemContent('아무거나');
    expect(out.startsWith(PRODUCT_PERSONA_KO)).toBe(true);
  });

  it('detects English when the FE prompt opens "You are Insighta..."', async () => {
    const out = await rewriteSystemContent(
      "You are Insighta's learning assistant. URL: https://www.youtube.com/watch?v=eng12345678"
    );

    expect(out.startsWith(PRODUCT_PERSONA_EN)).toBe(true);
    expect(mockLoadVideoContext).toHaveBeenCalledWith({
      youtubeVideoId: 'eng12345678',
      preferredLanguage: 'en',
    });
  });
});

describe('rewriteSystemContent — caching', () => {
  it('caches video context per videoId (second call within TTL hits cache)', async () => {
    mockLoadVideoContext.mockResolvedValue({ v2Data: SAMPLE_V2, transcript: null });

    await rewriteSystemContent('URL: https://www.youtube.com/watch?v=cache000001');
    await rewriteSystemContent('URL: https://www.youtube.com/watch?v=cache000001');

    expect(mockLoadVideoContext).toHaveBeenCalledTimes(1);
  });

  it('treats different videoIds as separate cache keys', async () => {
    mockLoadVideoContext.mockResolvedValue({ v2Data: null, transcript: null });

    await rewriteSystemContent('URL: https://www.youtube.com/watch?v=videoa00001');
    await rewriteSystemContent('URL: https://www.youtube.com/watch?v=videob00002');

    expect(mockLoadVideoContext).toHaveBeenCalledTimes(2);
  });
});

describe('rewriteSystemPrompt — LanguageModelV3 form', () => {
  it('returns null when prompt is empty', async () => {
    const result = await rewriteSystemPrompt([]);
    expect(result).toBeNull();
  });

  it('rewrites system messages and preserves non-system message order', async () => {
    const original = [
      { role: 'system' as const, content: 'sys A' },
      { role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] },
      { role: 'assistant' as const, content: [{ type: 'text' as const, text: 'hello' }] },
      { role: 'system' as const, content: 'sys B' },
    ];

    const result = await rewriteSystemPrompt(original);

    expect(result).not.toBeNull();
    expect(result!.length).toBe(3); // 1 rewritten system + 1 user + 1 assistant
    expect(result![0]!.role).toBe('system');
    expect(result![1]!.role).toBe('user');
    expect(result![2]!.role).toBe('assistant');
  });

  it('still emits a system message even when input has no system messages', async () => {
    const original = [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }] }];

    const result = await rewriteSystemPrompt(original);

    expect(result).not.toBeNull();
    expect(result![0]!.role).toBe('system');
    expect((result![0]! as { content: string }).content.startsWith(PRODUCT_PERSONA_KO)).toBe(true);
  });
});

describe('createQwenPromptMiddleware', () => {
  it('returns LanguageModelV3Middleware shape (specificationVersion=v3 + transformParams)', () => {
    const mw = createQwenPromptMiddleware();
    expect(mw.specificationVersion).toBe('v3');
    expect(typeof mw.transformParams).toBe('function');
  });

  it('transformParams rewrites the prompt on success', async () => {
    mockLoadVideoContext.mockResolvedValueOnce({ v2Data: SAMPLE_V2, transcript: null });
    const mw = createQwenPromptMiddleware();
    const inputParams = {
      prompt: [
        { role: 'system' as const, content: 'URL: https://www.youtube.com/watch?v=abc12345678' },
      ],
      maxOutputTokens: 100,
    };

    const out = await mw.transformParams!({
      type: 'stream',
      params: inputParams as never,
      model: {} as never,
    });

    expect(out.maxOutputTokens).toBe(100);
    expect(out.prompt[0]!.role).toBe('system');
    expect((out.prompt[0]! as { content: string }).content).toContain('[영상 정보]');
  });

  it('transformParams falls back to original params on inner error (fail-safe)', async () => {
    mockLoadVideoContext.mockRejectedValueOnce(new Error('db down'));
    const mw = createQwenPromptMiddleware();
    const inputParams = {
      prompt: [
        { role: 'system' as const, content: 'URL: https://www.youtube.com/watch?v=fail00000aa' },
      ],
      maxOutputTokens: 100,
    };

    const out = await mw.transformParams!({
      type: 'stream',
      params: inputParams as never,
      model: {} as never,
    });

    // On error, original params returned unchanged (no rewrite).
    expect(out).toBe(inputParams);
  });
});
