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
  fetchMorningFeedHistory,
  fetchMorningPage,
  fetchMorningPageCards,
  fetchMorningPageList,
  fetchMorningPagesHome,
  fetchWatchInsight,
  fetchWatchToday,
  patchReasonTags,
  postBriefFeedback,
  postFeedJudgment,
  postUsageEvent,
  postWatchBatch,
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

  it('reads the watch history from GET /api/v1/morning-feed/history', async () => {
    const rows = [{ cell: '기술/개발', day: '2026-10-28', count: 12 }];
    fetchMock.mockResolvedValue(okResponse({ status: 'ok', data: rows }));
    expect(await fetchMorningFeedHistory()).toEqual(rows);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/morning-feed\/history$/);
    expect(init.method).toBeUndefined();
  });

  it('pages: home, one page and the list hit the three read routes', async () => {
    const home = { current: null, lastDomain: null, others: [] };
    fetchMock.mockResolvedValue(okResponse({ status: 'ok', data: home }));
    expect(await fetchMorningPagesHome()).toEqual(home);
    await fetchMorningPage('기술/개발', '2026-11-14');
    await fetchMorningPageList('기술/개발');
    await fetchMorningPageCards('기술/개발', '2026-11-14');
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(decodeURIComponent(urls[3]!)).toMatch(
      /\/api\/v1\/morning-feed\/pages\/cards\?cell=기술\/개발&date=2026-11-14$/
    );
    expect(urls[0]).toMatch(/\/api\/v1\/morning-feed\/pages\/home$/);
    expect(decodeURIComponent(urls[1]!)).toMatch(
      /\/api\/v1\/morning-feed\/pages\?cell=기술\/개발&date=2026-11-14$/
    );
    expect(decodeURIComponent(urls[2]!)).toMatch(
      /\/api\/v1\/morning-feed\/pages\/list\?cell=기술\/개발$/
    );
  });

  it('feed judgment: the deck body keeps its four fields, the watch screen adds surface', async () => {
    fetchMock.mockResolvedValue(okResponse({ status: 'ok' }));
    const deck = {
      video_id: 'abcdefghijk',
      cell: '기술/개발',
      verdict: 'useful' as const,
      shown_position: 1,
    };
    await postFeedJudgment(deck);
    await postFeedJudgment({ ...deck, surface: 'watch' });
    const bodyOf = (i: number): Record<string, unknown> =>
      JSON.parse((fetchMock.mock.calls[i] as [string, RequestInit])[1].body as string);
    expect(Object.keys(bodyOf(0)).sort()).toEqual([
      'cell',
      'shown_position',
      'verdict',
      'video_id',
    ]);
    expect(bodyOf(1).surface).toBe('watch');
    const url = (fetchMock.mock.calls[1] as [string])[0];
    expect(url).toMatch(/\/api\/v1\/morning-feed\/judgments$/);
  });

  it('watch endpoints: GET /watch/today, POST /watch/batch, GET /watch/insight?cell=', async () => {
    fetchMock.mockResolvedValue(okResponse({ status: 'ok', data: {} }));
    await fetchWatchToday();
    await postWatchBatch('기술/개발');
    await fetchWatchInsight('기술/개발');
    const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
    expect(calls[0]![0]).toMatch(/\/api\/v1\/morning-feed\/watch\/today$/);
    expect(calls[0]![1].method).toBeUndefined();
    expect(calls[1]![0]).toMatch(/\/api\/v1\/morning-feed\/watch\/batch$/);
    expect(calls[1]![1].method).toBe('POST');
    expect(JSON.parse(calls[1]![1].body as string)).toEqual({ cell: '기술/개발' });
    expect(calls[2]![0]).toContain(
      '/api/v1/morning-feed/watch/insight?cell=' + encodeURIComponent('기술/개발')
    );
  });

  it('posts brief feedback to /pages/feedback with exactly cell, date, value', async () => {
    fetchMock.mockResolvedValue(
      okResponse({ status: 'ok', data: { cell: 'c', seen_date: '2026-11-13', value: 'useful' } })
    );
    const out = await postBriefFeedback({
      cell: 'c',
      date: '2026-11-13',
      value: 'useful',
      // @ts-expect-error extra field must not be forwarded
      extra: 1,
    });
    expect(out.value).toBe('useful');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/morning-feed/pages/feedback');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      cell: 'c',
      date: '2026-11-13',
      value: 'useful',
    });
  });

  it('posts a usage event to /events with only the given fields and never throws', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 204, json: async () => ({}) });
    await postUsageEvent({ kind: 'brief_open', cell: 'c', date: '2026-11-13' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/morning-feed/events');
    expect(JSON.parse(init.body as string)).toEqual({
      kind: 'brief_open',
      cell: 'c',
      date: '2026-11-13',
    });
    fetchMock.mockRejectedValue(new Error('offline'));
    await expect(postUsageEvent({ kind: 'home_open' })).resolves.toBeUndefined();
  });
});
