import { FeedValidationError, type FeedDb } from '@/modules/morning-feed/feed';
import {
  BRIEF_EVENT_KINDS,
  isBriefEventKind,
  recordBriefEvent,
  USAGE_EVENT_KINDS,
  validateBriefEvent,
  validateUsageEvent,
} from '@/modules/morning-feed/brief-usage';

/* Brief behaviour events (work order D1, 2026-11-25): POST /events, morning_usage_events. */

const USER = '11111111-1111-4111-8111-111111111111';
const OWNER = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-25T05:00:00Z');
const FULL = {
  kind: 'sentence_tap',
  cell: '기술/개발',
  date: '2026-11-25',
  video_id: 'aaaaaaaaaaa',
  value: 'body',
  sentence_id: 'p1.s2',
  paragraph: 1,
  start_sec: 160,
  end_sec: 171,
  from: '기술/개발',
  to: '창작/예술',
  at: '2026-11-25T04:59:00.000Z',
  id: ID,
};

function fakeDb(): { db: FeedDb; calls: unknown[][] } {
  const calls: unknown[][] = [];
  const db = {
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn(async (...args: unknown[]) => {
      calls.push(args);
      return 1;
    }),
  } as unknown as FeedDb;
  return { db, calls };
}

describe('brief events', () => {
  it('keeps every field of a complete event', () => {
    expect(validateBriefEvent(FULL, NOW)).toEqual({
      kind: 'sentence_tap',
      cell: '기술/개발',
      seen_date: '2026-11-25',
      video_id: 'aaaaaaaaaaa',
      value: 'body',
      sentence_id: 'p1.s2',
      paragraph: 1,
      start_sec: 160,
      end_sec: 171,
      from_cell: '기술/개발',
      to_cell: '창작/예술',
      occurred_at: '2026-11-25T04:59:00.000Z',
      client_event_id: ID,
    });
  });

  it('only an unknown kind refuses an event; a field that does not fit becomes null', () => {
    expect(() => validateBriefEvent({ kind: 'nope' })).toThrow(FeedValidationError);
    expect(() => validateBriefEvent(null)).toThrow(FeedValidationError);
    const bad = validateBriefEvent(
      {
        kind: 'play_range',
        cell: 'x',
        date: '2026-13-01',
        video_id: "a'; --",
        value: 'someone@example.com',
        sentence_id: 'p1.s2; drop',
        paragraph: -1,
        start_sec: 9,
        end_sec: 3,
        from: 7,
        to: {},
        at: '2020-01-01T00:00:00Z',
        id: 'x',
      },
      NOW
    );
    const { kind, ...rest } = bad;
    expect(kind).toBe('play_range');
    expect(Object.values(rest).every((v) => v === null)).toBe(true);
    const caps = validateBriefEvent({ kind: 'play_range', start_sec: 1.5, end_sec: 90000 }, NOW);
    expect([caps.start_sec, caps.end_sec]).toEqual([null, null]);
    expect(validateBriefEvent({ kind: 'share', at: '2026-11-25T06:00:00Z' }, NOW).occurred_at).toBe(
      null
    );
  });

  it('the old kinds keep the old rules and the two lists do not overlap', () => {
    for (const k of BRIEF_EVENT_KINDS) {
      expect(isBriefEventKind(k)).toBe(true);
      expect(USAGE_EVENT_KINDS).not.toContain(k);
      expect(k.length).toBeLessThanOrEqual(32);
    }
    expect(isBriefEventKind('brief_open')).toBe(false);
    expect(() => validateUsageEvent({ kind: 'brief_open', cell: 'x' })).toThrow(
      FeedValidationError
    );
  });

  it('writes one row, once per event id, with the brief owner', async () => {
    const { db, calls } = fakeDb();
    await recordBriefEvent(db, USER, OWNER, validateBriefEvent(FULL, NOW));
    expect(calls).toHaveLength(1);
    expect(String(calls[0]![0])).toMatch(/INSERT INTO public\.morning_usage_events/);
    expect(String(calls[0]![0])).toMatch(/WHERE NOT EXISTS/);
    expect(calls[0]!.slice(1)).toEqual([
      USER,
      'sentence_tap',
      '기술/개발',
      '2026-11-25',
      'aaaaaaaaaaa',
      'body',
      OWNER,
      'p1.s2',
      1,
      160,
      171,
      '기술/개발',
      '창작/예술',
      '2026-11-25T04:59:00.000Z',
      ID,
    ]);
  });

  it('names no brief owner when the event is not on a brief', async () => {
    const { db, calls } = fakeDb();
    await recordBriefEvent(db, USER, OWNER, validateBriefEvent({ kind: 'field_switch' }, NOW));
    expect(calls[0]![7]).toBeNull();
    await expect(
      recordBriefEvent(db, '', OWNER, validateBriefEvent({ kind: 'share' }, NOW))
    ).rejects.toThrow(FeedValidationError);
  });
});
