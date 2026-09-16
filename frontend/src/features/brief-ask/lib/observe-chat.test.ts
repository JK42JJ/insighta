import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAT_RUNTIME_PATH, observeChatResponses, refusalFromStatus } from './observe-chat';

function response(status: number, headers: Record<string, string> = {}): Response {
  return new Response('{}', { status, headers });
}

describe('refusalFromStatus', () => {
  it('names the two refusals the runtime sends and nothing else', () => {
    expect(refusalFromStatus(401)).toBe('unauthorized');
    expect(refusalFromStatus(429)).toBe('rate_limited');
    expect(refusalFromStatus(200)).toBeNull();
    expect(refusalFromStatus(503)).toBeNull();
  });
});

describe('observeChatResponses', () => {
  const original = window.fetch;
  afterEach(() => {
    window.fetch = original;
  });

  it('reports a refusal on the runtime path with its Retry-After, and passes the response through', async () => {
    window.fetch = vi.fn().mockResolvedValue(response(429, { 'retry-after': '120' }));
    const onRefusal = vi.fn();
    const stop = observeChatResponses(onRefusal);

    const res = await window.fetch(`${CHAT_RUNTIME_PATH}`, { method: 'POST' });
    expect(res.status).toBe(429);
    expect(onRefusal).toHaveBeenCalledWith('rate_limited', 120);
    stop();
  });

  it('ignores other paths and successful answers', async () => {
    const inner = vi.fn().mockResolvedValue(response(401));
    window.fetch = inner;
    const onRefusal = vi.fn();
    const stop = observeChatResponses(onRefusal);

    await window.fetch('/api/v1/brief/x/document');
    inner.mockResolvedValue(response(200));
    await window.fetch(CHAT_RUNTIME_PATH);
    expect(onRefusal).not.toHaveBeenCalled();
    stop();
  });

  it('restores the previous fetch when removed', () => {
    const before = vi.fn();
    window.fetch = before as unknown as typeof window.fetch;
    const stop = observeChatResponses(() => undefined);
    expect(window.fetch).not.toBe(before);
    stop();
    expect(window.fetch).toBe(before);
  });
});
