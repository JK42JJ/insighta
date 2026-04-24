/**
 * Rich Summary API client smoke test — CP425 (C1).
 *
 * Covers:
 *   - getVideoRichSummary returns null on 404 (empty-state contract)
 *   - getVideoRichSummary returns data on 200
 *   - getVideoRichSummary propagates 5xx errors (does NOT swallow)
 *   - triggerMandalaRichSummary POSTs to the correct endpoint
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
}));

vi.mock('@/shared/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      refreshSession: vi.fn(() => Promise.resolve({ data: { session: null } })),
    },
  },
}));

vi.mock('../../shared/lib/auth-event-bus', () => ({
  subscribeAuth: vi.fn(() => () => undefined),
}));

describe('apiClient rich-summary methods (CP425 C1)', () => {
  const originalFetch = globalThis.fetch;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockGetSession.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it('getVideoRichSummary returns null on 404', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'not found', statusCode: 404 }), { status: 404 })
    );
    const { apiClient } = await import('@/shared/lib/api-client');
    const result = await apiClient.getVideoRichSummary('abc12345678');
    expect(result).toBeNull();
  });

  it('getVideoRichSummary returns data on 200', async () => {
    const payload = {
      status: 'ok',
      data: {
        videoId: 'abc12345678',
        oneLiner: 'A short one-liner',
        structured: { key_points: ['p1', 'p2'], tl_dr_ko: '한 줄' },
        qualityScore: 0.8,
        model: 'test-model',
        updatedAt: '2026-04-24T00:00:00.000Z',
      },
    };
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));
    const { apiClient } = await import('@/shared/lib/api-client');
    const result = await apiClient.getVideoRichSummary('abc12345678');
    expect(result).not.toBeNull();
    expect(result?.videoId).toBe('abc12345678');
    expect(result?.structured?.key_points).toEqual(['p1', 'p2']);
  });

  it('getVideoRichSummary propagates 500 errors (does NOT swallow)', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: 'boom', statusCode: 500 }), { status: 500 })
    );
    const { apiClient } = await import('@/shared/lib/api-client');
    await expect(apiClient.getVideoRichSummary('abc12345678')).rejects.toThrow(/boom/);
  });

  it('triggerMandalaRichSummary POSTs to /mandalas/:id/rich-summary-trigger', async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ status: 'ok', data: { enqueued: 3 } }), { status: 202 })
    );
    const { apiClient } = await import('@/shared/lib/api-client');
    await apiClient.triggerMandalaRichSummary('mandala-uuid');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/mandalas\/mandala-uuid\/rich-summary-trigger$/);
    expect(init.method).toBe('POST');
  });
});
