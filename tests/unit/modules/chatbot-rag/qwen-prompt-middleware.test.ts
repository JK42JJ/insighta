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
  appendNoThinkDirective,
  appendNoThinkToLastUserMessage,
  appendNoThinkToLastUserMessageString,
  appendTimestampFormatRule,
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

  it('CP475+4 — transformParams forces toolChoice=none + empty tools', async () => {
    // The vLLM Pod was launched without --enable-auto-tool-choice, so any
    // inbound `tool_choice: 'auto'` returns 400. Middleware must always
    // override regardless of caller intent.
    const mw = createQwenPromptMiddleware();
    const inputParams = {
      prompt: [{ role: 'system' as const, content: 'arbitrary' }],
      toolChoice: { type: 'auto' as const },
      tools: [
        {
          type: 'function' as const,
          name: 'someTool',
          description: '',
          inputSchema: {},
        },
      ],
    };

    const out = await mw.transformParams!({
      type: 'stream',
      params: inputParams as never,
      model: {} as never,
    });

    expect(out.toolChoice).toEqual({ type: 'none' });
    expect(out.tools).toEqual([]);
  });
});

describe('appendNoThinkDirective (CP475+5)', () => {
  it('appends /no_think to a system prompt lacking it', () => {
    expect(appendNoThinkDirective('You are Insighta...')).toBe('You are Insighta...\n\n/no_think');
  });

  it('is idempotent — does not add /no_think twice', () => {
    const once = appendNoThinkDirective('hello');
    const twice = appendNoThinkDirective(once);
    expect(twice).toBe(once);
  });

  it('passes through if /no_think already appears anywhere in the content', () => {
    const prompt = 'instructions\n/no_think\nmore instructions';
    expect(appendNoThinkDirective(prompt)).toBe(prompt);
  });
});

describe('rewriteSystemContent — CP477+4 /no_think REMOVED from system prompt', () => {
  // CP475+5 had appended `/no_think` to the system prompt; CP477+4 reverted
  // that because the directive only works at user-message end (Qwen3 chat
  // template requirement). The system-prompt placement caused token echo on
  // the OpenRouter base model AND multi-turn history corruption.
  it('does NOT contain /no_think anywhere (Korean)', async () => {
    const out = await rewriteSystemContent('한국어 인사이트 챗봇 사용');
    expect(out).not.toContain('/no_think');
  });

  it('does NOT contain /no_think anywhere (English)', async () => {
    const out = await rewriteSystemContent("You are Insighta's learning assistant.");
    expect(out).not.toContain('/no_think');
  });
});

describe('appendTimestampFormatRule (CP477+2)', () => {
  it('adds the Korean rule when language=ko + marker absent', () => {
    const out = appendTimestampFormatRule('hello', 'ko');
    expect(out).toContain('[타임스탬프 형식]');
    expect(out).toContain('"M:SS"');
    expect(out).toContain('"N초"');
  });

  it('adds the English rule when language=en + marker absent', () => {
    const out = appendTimestampFormatRule('hello', 'en');
    expect(out).toContain('[Timestamp format]');
    expect(out).toContain('"M:SS"');
    expect(out).toContain('380s');
  });

  it('is idempotent on Korean — second call returns input unchanged', () => {
    const once = appendTimestampFormatRule('hello', 'ko');
    const twice = appendTimestampFormatRule(once, 'ko');
    expect(twice).toBe(once);
  });

  it('is idempotent on English', () => {
    const once = appendTimestampFormatRule('hello', 'en');
    const twice = appendTimestampFormatRule(once, 'en');
    expect(twice).toBe(once);
  });

  it('does not double-add when KO marker exists and EN call follows', () => {
    // Either marker variant should short-circuit, regardless of language arg.
    const out = appendTimestampFormatRule('foo\n[타임스탬프 형식]\nbar', 'en');
    expect(out).toBe('foo\n[타임스탬프 형식]\nbar');
  });
});

describe('rewriteSystemContent — CP477+2 timestamp rule injection', () => {
  it('Korean system prompt contains the timestamp rule (CP477+4: no /no_think appended)', async () => {
    const out = await rewriteSystemContent('한국어 인사이트 챗봇 사용');
    expect(out).toContain('[타임스탬프 형식]');
    expect(out).not.toContain('/no_think');
  });

  it('English system prompt also gets the rule', async () => {
    const out = await rewriteSystemContent("You are Insighta's learning assistant.");
    expect(out).toContain('[Timestamp format]');
    expect(out).not.toContain('/no_think');
  });
});

describe('appendNoThinkToLastUserMessage (CP477+5) — V3 prompt shape', () => {
  // Tests cover the Vercel-SDK getLanguageModel() path. V3 user content is
  // `Array<TextPart | FilePart>` (string for `system`, array for others).
  type Msg = Parameters<typeof appendNoThinkToLastUserMessage>[0][number];

  function userText(text: string): Msg {
    return { role: 'user', content: [{ type: 'text', text }] } as Msg;
  }
  function assistantText(text: string): Msg {
    return { role: 'assistant', content: [{ type: 'text', text }] } as Msg;
  }
  function systemText(text: string): Msg {
    return { role: 'system', content: text } as Msg;
  }

  it('appends `/no_think` to the last user message text', () => {
    const out = appendNoThinkToLastUserMessage([systemText('persona'), userText('영상 요약')]);
    expect(out[1]!.role).toBe('user');
    expect((out[1]! as { content: Array<{ type: string; text: string }> }).content[0]!.text).toBe(
      '영상 요약 /no_think'
    );
  });

  it('multi-turn — only the LAST user message gets the directive', () => {
    const out = appendNoThinkToLastUserMessage([
      systemText('persona'),
      userText('first turn'),
      assistantText('first answer'),
      userText('second turn'),
    ]);
    expect((out[1]! as { content: Array<{ type: string; text: string }> }).content[0]!.text).toBe(
      'first turn'
    ); // untouched
    expect((out[3]! as { content: Array<{ type: string; text: string }> }).content[0]!.text).toBe(
      'second turn /no_think'
    );
  });

  it('idempotent — second call leaves the message unchanged', () => {
    const once = appendNoThinkToLastUserMessage([userText('hi')]);
    const twice = appendNoThinkToLastUserMessage(once);
    expect(twice).toBe(once);
  });

  it('preserves trailing whitespace normalization (uses trimEnd before appending)', () => {
    const out = appendNoThinkToLastUserMessage([userText('hi   \n\n')]);
    expect((out[0]! as { content: Array<{ type: string; text: string }> }).content[0]!.text).toBe(
      'hi /no_think'
    );
  });

  it('handles empty prompt without throwing', () => {
    expect(appendNoThinkToLastUserMessage([])).toEqual([]);
  });

  it('no user message in prompt → passthrough', () => {
    const input = [systemText('persona only')];
    expect(appendNoThinkToLastUserMessage(input)).toBe(input);
  });

  it('user message with empty parts array → passthrough', () => {
    const input = [{ role: 'user' as const, content: [] }] as unknown as Msg[];
    expect(appendNoThinkToLastUserMessage(input)).toBe(input);
  });

  it('user message ending with a FilePart still gets directive on the last TextPart', () => {
    const input = [
      {
        role: 'user' as const,
        content: [
          { type: 'text', text: '이 영상' },
          { type: 'file', mediaType: 'image/png', data: 'base64...' },
        ],
      },
    ] as unknown as Msg[];
    const out = appendNoThinkToLastUserMessage(input);
    expect((out[0]! as { content: Array<{ type: string; text?: string }> }).content[0]!.text).toBe(
      '이 영상 /no_think'
    );
    // file part untouched
    expect((out[0]! as { content: Array<{ type: string }> }).content[1]!.type).toBe('file');
  });
});

describe('appendNoThinkToLastUserMessageString (CP477+5) — legacy process() path', () => {
  it('appends `/no_think` to the last user message content string', () => {
    const out = appendNoThinkToLastUserMessageString([
      { role: 'system', content: 'persona' },
      { role: 'user', content: '영상 요약' },
    ]);
    expect(out[1]!.content).toBe('영상 요약 /no_think');
  });

  it('multi-turn — only the LAST user message', () => {
    const out = appendNoThinkToLastUserMessageString([
      { role: 'system', content: 'persona' },
      { role: 'user', content: 'first turn' },
      { role: 'assistant', content: 'first answer' },
      { role: 'user', content: 'second turn' },
    ]);
    expect(out[1]!.content).toBe('first turn');
    expect(out[3]!.content).toBe('second turn /no_think');
  });

  it('idempotent', () => {
    const once = appendNoThinkToLastUserMessageString([{ role: 'user', content: 'hi' }]);
    const twice = appendNoThinkToLastUserMessageString(once);
    expect(twice).toBe(once);
  });

  it('empty input → passthrough', () => {
    const input: Parameters<typeof appendNoThinkToLastUserMessageString>[0] = [];
    expect(appendNoThinkToLastUserMessageString(input)).toBe(input);
  });

  it('no user message in input → passthrough', () => {
    const input: Parameters<typeof appendNoThinkToLastUserMessageString>[0] = [
      { role: 'system', content: 'persona' },
    ];
    expect(appendNoThinkToLastUserMessageString(input)).toBe(input);
  });
});

describe('createQwenPromptMiddleware — CP477+5 end-to-end shape', () => {
  it('transformParams output has /no_think on the LAST user message (not in system)', async () => {
    const mw = createQwenPromptMiddleware();
    const out = await mw.transformParams!({
      type: 'stream',
      params: {
        prompt: [
          { role: 'system' as const, content: 'persona' },
          {
            role: 'user' as const,
            content: [{ type: 'text', text: '영상 요약 부탁' }],
          },
        ],
      } as never,
      model: {} as never,
    });
    // system message rewritten by middleware — must NOT carry /no_think
    expect((out.prompt[0]! as { content: string }).content).not.toContain('/no_think');
    // user message tail — MUST carry /no_think
    const userPart = (
      out.prompt[1]! as {
        content: Array<{ type: string; text: string }>;
      }
    ).content[0]!;
    expect(userPart.text.endsWith('/no_think')).toBe(true);
  });
});
