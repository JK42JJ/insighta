/**
 * apiClient.markBetaInvited — empty-body 400 regression guard.
 *
 * The bug (prod 2026-07-14, admin Beta Campaign "초대 처리" click): a body-less
 * POST still gets Content-Type: application/json from request(), and Fastify
 * rejects an empty JSON body with FST_ERR_CTP_EMPTY_JSON_BODY (400) BEFORE the
 * route runs — the application never flips to 'invited'. Same class as #935
 * (generateSlideDeck) and #860 (prewarm).
 *
 * This test exercises the REAL fetch shape: it asserts the request carries a
 * non-empty JSON body. On the unfixed method (no body) `init.body` is undefined
 * → this test FAILS. That failure is the point — it is a true guard.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/shared/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      refreshSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  },
}));

import { apiClient } from '@/shared/lib/api-client';

describe('apiClient.markBetaInvited — empty-body 400 guard', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ application: { id: 'a1', status: 'invited' } }),
      text: async () => '{"application":{"id":"a1","status":"invited"}}',
      headers: new Headers({ 'content-type': 'application/json' }),
    });
    vi.stubGlobal('fetch', fetchMock);
  });

  it('sends a non-empty JSON body (else FST_ERR_CTP_EMPTY_JSON_BODY 400)', async () => {
    try {
      await apiClient.markBetaInvited('a1');
    } catch {
      // Response-parsing details are irrelevant — we assert on the request that
      // was actually sent (the body is set before the response is read).
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/admin/beta-applications/a1/mark-invited');
    expect(init.method).toBe('POST');

    // request() always sets JSON content-type → an empty body 400s server-side.
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');

    // THE GUARD: a body MUST be present and valid JSON.
    expect(init.body).toBeDefined();
    expect(init.body).not.toBe('');
    expect(() => JSON.parse(init.body as string)).not.toThrow();
  });
});
