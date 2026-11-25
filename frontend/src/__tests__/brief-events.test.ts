import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BRIEF_EVENT_KINDS } from '@/shared/lib/brief-event-kinds';

/*
 * Brief events (work order D1, 2026-11-25): stored by our API under the same name PostHog gets, no
 * name or e-mail, kept on the phone until the server has them.
 */

const m = vi.hoisted(() => ({
  capture: vi.fn(),
  user: 'u1' as string | null,
  onAuth: null as null | ((e: string, s: unknown) => void),
}));
vi.mock('@/shared/lib/posthog', () => ({ captureBriefEvent: m.capture }));
vi.mock('@/shared/integrations/supabase/client', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: m.user ? { access_token: `t-${m.user}`, user: { id: m.user } } : null },
      }),
      onAuthStateChange: (cb: (e: string, s: unknown) => void) => {
        m.onAuth = cb;
      },
    },
  },
}));

const fetchMock = vi.fn();
const KEY = 'insighta-brief-events';
const settle = () => new Promise((r) => setTimeout(r, 5));
const bodies = () =>
  fetchMock.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string));

async function load() {
  vi.resetModules();
  return (await import('@/features/morning-feed/brief-events')).recordBriefEvent;
}

beforeEach(() => {
  localStorage.clear();
  m.capture.mockReset();
  m.user = 'u1';
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 204 });
  vi.stubGlobal('fetch', fetchMock);
});

describe('recordBriefEvent', () => {
  it('has the same kinds as the server', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../src/modules/morning-feed/brief-usage.ts'),
      'utf8'
    );
    const list = /BRIEF_EVENT_KINDS = \[([^\]]*)\]/.exec(src)![1]!;
    expect([...list.matchAll(/'([a-z_]+)'/g)].map((x) => x[1])).toEqual([...BRIEF_EVENT_KINDS]);
  });

  it('sends the event to our API (keepalive) and to PostHog, with nothing that names a person', async () => {
    const record = await load();
    record('play_range', {
      cell: '기술/개발',
      seenDate: '2026-11-25',
      sentenceId: 'p1.s2',
      videoId: 'aaaaaaaaaaa',
      startSec: 160.8,
      endSec: 171.2,
    });
    await settle();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/morning-feed/events');
    expect(url).not.toContain('/api/v1/api/v1');
    expect(init.keepalive).toBe(true);
    const { id, at, ...rest } = bodies()[0];
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(at))).toBe(false);
    const given = {
      cell: '기술/개발',
      date: '2026-11-25',
      sentence_id: 'p1.s2',
      video_id: 'aaaaaaaaaaa',
      start_sec: 160,
      end_sec: 171,
    };
    expect(rest).toEqual({ kind: 'play_range', ...given });
    expect(m.capture.mock.calls).toEqual([['play_range', given]]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('a lost event stays on the phone and goes with the next one, under the same id', async () => {
    const record = await load();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    record('share', { value: 'copy' });
    await settle();
    expect(JSON.parse(localStorage.getItem(KEY)!)).toHaveLength(1);
    record('field_switch', { from: 'a', to: 'b' });
    await settle();
    const all = bodies();
    expect(all.map((b) => b.kind)).toEqual(['share', 'field_switch', 'share']);
    expect(all[2].id).toBe(all[0].id);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('what is left from an earlier visit is sent; another person does not send it', async () => {
    let record = await load();
    fetchMock.mockResolvedValue({ ok: false, status: 502 });
    record('share');
    await settle();
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 204 });
    m.user = 'u2';
    record = await load();
    record('headline_view');
    await settle();
    expect(bodies().map((b) => b.kind)).toEqual(['headline_view']);
    m.user = 'u1';
    record = await load();
    record('headline_select');
    await settle();
    expect(bodies().map((b) => b.kind)).toEqual(['headline_view', 'headline_select', 'share']);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('an event the server refuses is not sent again; a signed-out one is nobody’s', async () => {
    const record = await load();
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400 });
    record('suggest');
    await settle();
    expect(localStorage.getItem(KEY)).toBeNull();
    m.user = null;
    m.onAuth?.('SIGNED_OUT', null);
    record('suggest');
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('once the person is known the event is on the phone before anything is sent', async () => {
    const record = await load();
    record('headline_view');
    await settle();
    fetchMock.mockReturnValue(new Promise(() => undefined)); // the page closes before an answer
    record('play_range', { startSec: 1, endSec: 2 });
    const left = JSON.parse(localStorage.getItem(KEY)!);
    expect(left).toHaveLength(1);
    expect(left[0].user).toBe('u1');
  });

  it('never throws, whatever the storage or the network does', async () => {
    const record = await load();
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('full');
    });
    expect(() => record('reaction', { value: 'useful' })).not.toThrow();
    await settle();
    expect(bodies()[0].kind).toBe('reaction');
    set.mockRestore();
  });
});
