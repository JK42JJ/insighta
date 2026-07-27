/**
 * Topic judge — transport, parsing and the failure policy.
 *
 * The model itself is stubbed: what matters here is that a missing verdict is
 * never treated as approval, and that an outage degrades to the deterministic
 * floor rather than to "everything passes".
 */

import { judgeTopics, JUDGE_BATCH_SIZE } from '../../src/modules/curation/topic-judge';

// CI has no OPENROUTER_API_KEY, and the module fails closed without one — inject
// a key so these exercise the request path rather than the outage path.
const KEY = 'test-key';

function reply(rows: Array<{ i: number; s: boolean; l: boolean; w?: string }>, wrap = false) {
  const payload = JSON.stringify({ r: rows });
  const content = wrap ? '```json\n' + payload + '\n```' : payload;
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  } as unknown as Response;
}

describe('judgeTopics — verdict mapping', () => {
  it('maps both axes independently', async () => {
    const fetchImpl = jest.fn(async () =>
      reply([
        { i: 0, s: true, l: true },
        { i: 1, s: false, l: false, w: 'sexual' },
        { i: 2, s: true, l: false, w: 'song title' },
      ])
    ) as unknown as typeof fetch;

    const out = await judgeTopics(
      ['자바스크립트', 'ai 란제리 룩북', 'carol of the bells'],
      fetchImpl
    );
    expect(out[0]!).toMatchObject({ safe: true, learnable: true, degraded: false });
    expect(out[1]!).toMatchObject({ safe: false, learnable: false });
    // harmless but not a study subject — the axis a word list cannot see
    expect(out[2]!).toMatchObject({ safe: true, learnable: false, why: 'song title' });
  });

  it('tolerates a markdown-fenced reply', async () => {
    const fetchImpl = jest.fn(async () =>
      reply([{ i: 0, s: true, l: true }], true)
    ) as unknown as typeof fetch;
    const out = await judgeTopics(['파이썬'], fetchImpl, KEY);
    expect(out[0]!).toMatchObject({ safe: true, learnable: true, degraded: false });
  });
});

describe('judgeTopics — failure policy', () => {
  it('degrades to the deterministic floor when the call fails', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const out = await judgeTopics(['ai 란제리 룩북', '자바스크립트'], fetchImpl, KEY);
    // blocklist still catches the explicit one
    expect(out[0]!).toMatchObject({ safe: false, degraded: true });
    // and nothing is declared learnable on a guess
    expect(out[0]!.learnable).toBe(false);
    expect(out[1]!).toMatchObject({ safe: true, learnable: false, degraded: true });
  });

  it('degrades on a non-OK HTTP status', async () => {
    const fetchImpl = jest.fn(
      async () => ({ ok: false, status: 502 }) as unknown as Response
    ) as unknown as typeof fetch;
    const out = await judgeTopics(['자바스크립트'], fetchImpl, KEY);
    expect(out[0]!.degraded).toBe(true);
    expect(out[0]!.learnable).toBe(false);
  });

  it('does NOT approve a keyword the model omitted', async () => {
    // only index 0 comes back for a two-item batch
    const fetchImpl = jest.fn(async () =>
      reply([{ i: 0, s: true, l: true }])
    ) as unknown as typeof fetch;
    const out = await judgeTopics(['자바스크립트', '수영로교회'], fetchImpl, KEY);
    // the whole batch degrades rather than silently passing the missing one
    expect(out.every((v) => v.degraded)).toBe(true);
    expect(out.every((v) => v.learnable === false)).toBe(true);
  });

  it('degrades on unparseable content', async () => {
    const fetchImpl = jest.fn(
      async () =>
        ({
          ok: true,
          json: async () => ({ choices: [{ message: { content: 'sure!' } }] }),
        }) as unknown as Response
    ) as unknown as typeof fetch;
    const out = await judgeTopics(['자바스크립트'], fetchImpl, KEY);
    expect(out[0]!.degraded).toBe(true);
  });
});

describe('judgeTopics — batching', () => {
  it('splits into batches and covers every keyword exactly once', async () => {
    const total = JUDGE_BATCH_SIZE + 7;
    const keywords = Array.from({ length: total }, (_, i) => `kw-${i}`);
    let calls = 0;
    const fetchImpl = jest.fn(async (_url: unknown, init: unknown) => {
      calls++;
      const body = JSON.parse((init as { body: string }).body) as {
        messages: Array<{ content: string }>;
      };
      const n = (body.messages[1]?.content ?? '').split('\n').length;
      return reply(Array.from({ length: n }, (_, i) => ({ i, s: true, l: true })));
    }) as unknown as typeof fetch;

    const out = await judgeTopics(keywords, fetchImpl, KEY);
    expect(calls).toBe(2);
    expect(out).toHaveLength(total);
    expect(out.map((v) => v.keyword)).toEqual(keywords);
  });

  it('returns an empty array for no input without calling out', async () => {
    const fetchImpl = jest.fn() as unknown as typeof fetch;
    expect(await judgeTopics([], fetchImpl, KEY)).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
