import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  agoLabel,
  channelColor,
  formatDuration,
  formatViews,
  toFeedCard,
} from '@/features/morning-feed/feed-format';
import { JudgmentQueue, type QueueOp } from '@/features/morning-feed/judgment-queue';

const NOW = new Date('2026-11-07T12:00:00Z');
const PALETTE = ['#111111', '#222222', '#333333'];

describe('feed formatting', () => {
  it('formats durations like the reference (m:ss, h:mm:ss)', () => {
    expect(formatDuration(862)).toBe('14:22');
    expect(formatDuration(555)).toBe('9:15');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('ago label: N일 전 under a week (orange), then N주 전, N개월 전', () => {
    const at = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
    expect(agoLabel(at(0), NOW)).toEqual({ text: '오늘', fresh: true });
    expect(agoLabel(at(6), NOW)).toEqual({ text: '6일 전', fresh: true });
    expect(agoLabel(at(7), NOW)).toEqual({ text: '1주 전', fresh: false });
    expect(agoLabel(at(21), NOW)).toEqual({ text: '3주 전', fresh: false });
    expect(agoLabel(at(65), NOW)).toEqual({ text: '2개월 전', fresh: false });
  });

  it('views text', () => {
    expect(formatViews(1234)).toBe('조회수 1,234회');
    expect(formatViews(12_345)).toBe('조회수 1.2만회');
    expect(formatViews(20_000)).toBe('조회수 2만회');
    expect(formatViews(null)).toBe('');
  });

  it('channel colour is stable for a name and comes from the palette', () => {
    expect(channelColor('택스노트', PALETTE)).toBe(channelColor('택스노트', PALETTE));
    expect(PALETTE).toContain(channelColor('AI 랩', PALETTE));
  });

  it('maps an API card to a screen card with no invented text', () => {
    const c = toFeedCard(
      {
        video_id: 'abcdefghijk',
        title: '제목',
        channel: '채널',
        published_at: new Date(NOW.getTime() - 2 * 86_400_000).toISOString(),
        duration: 600,
        view_count: 5000,
        thumbnail_url: 'https://img.example/x.jpg',
        cell: '기술/개발',
        focus: ['AI 도구'],
        why: '이유',
      },
      PALETTE,
      NOW
    );
    expect(c).toMatchObject({
      videoId: 'abcdefghijk',
      thumbUrl: 'https://img.example/x.jpg',
      ago: '2일 전',
      fresh: true,
      dur: '10:00',
      ini: '채',
      thumb: '',
      cell: '기술/개발',
      why: '이유',
    });
  });
});

describe('judgment queue', () => {
  const store: Record<string, string> = {};
  const storage = {
    getItem: (k: string) => store[k] ?? null,
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
  };
  const judge = (n: number): QueueOp => ({
    kind: 'judge',
    body: { video_id: 'abcdefghij' + n, cell: '기술/개발', verdict: 'useful', shown_position: n },
  });

  beforeEach(() => {
    vi.useFakeTimers();
    for (const k of Object.keys(store)) delete store[k];
  });
  afterEach(() => vi.useRealTimers());

  it('sends in order and empties itself', async () => {
    const sent: QueueOp[] = [];
    const q = new JudgmentQueue({ send: async (op) => void sent.push(op), storage });
    q.enqueue(judge(0));
    q.enqueue(judge(1));
    await vi.runAllTimersAsync();
    expect(sent.map((o) => (o.kind === 'judge' ? o.body.shown_position : -1))).toEqual([0, 1]);
    expect(q.size).toBe(0);
  });

  it('keeps a failed write, persists it, and retries until it goes through', async () => {
    let fail = 2;
    const sent: QueueOp[] = [];
    const q = new JudgmentQueue({
      send: async (op) => {
        if (fail-- > 0) throw new Error('offline');
        sent.push(op);
      },
      storage,
    });
    q.enqueue(judge(3));
    await vi.advanceTimersByTimeAsync(0);
    expect(q.size).toBe(1);
    expect(JSON.parse(store['mf_judge_queue_v1'])).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sent).toHaveLength(1);
    expect(q.size).toBe(0);
  });

  it('a queue saved by an earlier session is sent on flush', async () => {
    store['mf_judge_queue_v1'] = JSON.stringify([judge(7)]);
    const sent: QueueOp[] = [];
    const q = new JudgmentQueue({ send: async (op) => void sent.push(op), storage });
    expect(q.size).toBe(1);
    await q.flush();
    expect(sent).toHaveLength(1);
  });

  it('undo of a judgment that was never sent removes it instead of writing', async () => {
    const sent: QueueOp[] = [];
    const q = new JudgmentQueue({
      send: async (op) => {
        await new Promise((r) => setTimeout(r, 5000));
        sent.push(op);
      },
      storage,
    });
    q.enqueue(judge(0)); // goes in flight
    q.enqueue(judge(1)); // waits behind it
    q.enqueue({ kind: 'undo' }); // cancels the waiting one
    await vi.runAllTimersAsync();
    expect(sent.map((o) => o.kind)).toEqual(['judge']);
  });

  it('undo after a judgment was sent is sent as an undo', async () => {
    const sent: QueueOp[] = [];
    const q = new JudgmentQueue({ send: async (op) => void sent.push(op), storage });
    q.enqueue(judge(0));
    await vi.runAllTimersAsync();
    q.enqueue({ kind: 'undo' });
    await vi.runAllTimersAsync();
    expect(sent.map((o) => o.kind)).toEqual(['judge', 'undo']);
  });
});
