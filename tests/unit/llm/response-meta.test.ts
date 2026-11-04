import { extractResponseMeta } from '../../../src/modules/llm/response-meta';

describe('extractResponseMeta', () => {
  it('reads a reasoning-only response cut off by the token cap', () => {
    const meta = extractResponseMeta({
      model: 'deepseek/deepseek-v4-flash-0731',
      provider: 'ExampleHost',
      choices: [
        {
          message: { content: '', reasoning: 'x'.repeat(30_000) },
          finish_reason: 'length',
          native_finish_reason: 'length',
        },
      ],
      usage: {
        prompt_tokens: 7999,
        completion_tokens: 8192,
        completion_tokens_details: { reasoning_tokens: 8192 },
      },
    });
    expect(meta).toEqual({
      responseModel: 'deepseek/deepseek-v4-flash-0731',
      provider: 'ExampleHost',
      finishReason: 'length',
      nativeFinishReason: 'length',
      completionTokens: 8192,
      reasoningTokens: 8192,
      reasoningChars: 30_000,
      contentChars: 0,
    });
  });

  it('reads a normal response that stopped on its own', () => {
    const meta = extractResponseMeta({
      choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }],
      usage: { completion_tokens: 5 },
    });
    expect(meta.finishReason).toBe('stop');
    expect(meta.contentChars).toBe(11);
    expect(meta.reasoningChars).toBe(0);
    expect(meta.reasoningTokens).toBeUndefined();
  });

  it('does not fail on a response with none of the optional fields', () => {
    expect(extractResponseMeta({})).toEqual({
      responseModel: undefined,
      provider: undefined,
      finishReason: undefined,
      nativeFinishReason: undefined,
      completionTokens: undefined,
      reasoningTokens: undefined,
      reasoningChars: 0,
      contentChars: 0,
    });
  });

  it('treats a null body and a null finish reason as absent', () => {
    const meta = extractResponseMeta({
      choices: [{ message: { content: null, reasoning: null }, finish_reason: null }],
    });
    expect(meta.contentChars).toBe(0);
    expect(meta.reasoningChars).toBe(0);
    expect(meta.finishReason).toBeUndefined();
  });
});
