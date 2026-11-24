import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/shared/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { access_token: 'test-token' } } }),
    },
  },
}));

import {
  fetchMorningCards,
  fetchMorningCardsReview,
  patchReasonTags,
  postJudgment,
  MorningCardsApiError,
} from '@/features/morning-cards/api';

function okResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

describe('morning cards api client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('fetches cards for a domain with the bearer token', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ data: { domain: 'ai_tools', cards: [], shortage: true } })
    );
    const res = await fetchMorningCards('ai_tools');
    expect(res.shortage).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/morning-cards/?domain=ai_tools');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-token');
  });

  it('posts a judgment body with exactly video_id, domain, verdict, shown_position', async () => {
    fetchMock.mockResolvedValue(okResponse({ status: 'ok' }));
    await postJudgment({
      video_id: 'abcdefghijk',
      domain: 'work_practice',
      verdict: 'useful',
      shown_position: 2,
      // @ts-expect-error extra field must not be forwarded
      title: 'leak',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/morning-cards/judgments');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['domain', 'shown_position', 'verdict', 'video_id']);
  });

  it('loads the review list and patches reason tags', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ data: { domain: 'ai_tools', items: [], shortage: false } })
    );
    await fetchMorningCardsReview('ai_tools');
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain('/review?domain=ai_tools');

    fetchMock.mockResolvedValue(okResponse({ status: 'ok' }));
    await patchReasonTags({
      video_id: 'abcdefghijk',
      domain: 'ai_tools',
      reason_tags: ['outdated'],
    });
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain('/judgments/reason-tags');
    expect(init.method).toBe('PATCH');
  });

  it('throws a typed error on non-ok responses', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    await expect(fetchMorningCards('ai_tools')).rejects.toBeInstanceOf(MorningCardsApiError);
  });
});
