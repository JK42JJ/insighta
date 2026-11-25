import { FeedValidationError, type FeedDb } from '@/modules/morning-feed/feed';
import {
  recordUsageEvent,
  USAGE_EVENT_KINDS,
  validateUsageEvent,
} from '@/modules/morning-feed/brief-usage';

/*
 * Usage event allow-list (landing page, 2026-11-24): the landing's events are kept in the
 * visitor's tab and sent after Google sign-in with login_done, through the same POST /events.
 */

const USER = '11111111-1111-4111-8111-111111111111';
const LANDING_KINDS = [
  'landing_open',
  'landing_scene',
  'landing_swipe',
  'source_click',
  'landing_scroll_step3',
  'start_click',
  'add_click',
  'login_done',
] as const;

describe('usage event allow-list', () => {
  it('accepts the landing kinds next to the existing ones', () => {
    for (const kind of LANDING_KINDS) {
      expect(USAGE_EVENT_KINDS).toContain(kind);
      expect(validateUsageEvent({ kind })).toEqual({
        kind,
        cell: null,
        seen_date: null,
        video_id: null,
        value: null,
      });
    }
    for (const kind of ['home_open', 'brief_open', 'evidence_open', 'video_reaction']) {
      expect(USAGE_EVENT_KINDS).toContain(kind);
    }
  });

  it('start_click carries which button (sticky or final) as its value', () => {
    expect(validateUsageEvent({ kind: 'start_click', value: 'sticky' }).value).toBe('sticky');
    expect(validateUsageEvent({ kind: 'start_click', value: 'final' }).value).toBe('final');
  });

  it('landing_swipe carries direction + result, distance and speed', () => {
    for (const value of ['ng_34_120', 'pb_2_0', 'nb_999_999']) {
      expect(validateUsageEvent({ kind: 'landing_swipe', value }).value).toBe(value);
    }
  });

  it('landing v4: landing_scene carries the dot (s1..s6), start_click the header link too', () => {
    for (const value of ['s1', 's2', 's3', 's4', 's5', 's6']) {
      expect(validateUsageEvent({ kind: 'landing_scene', value }).value).toBe(value);
    }
    expect(validateUsageEvent({ kind: 'start_click', value: 'header' }).value).toBe('header');
    expect(validateUsageEvent({ kind: 'source_click' }).value).toBeNull();
  });

  it('rejects an unknown kind and a value outside the short-token shape', () => {
    expect(() => validateUsageEvent({ kind: 'landing_close' })).toThrow(FeedValidationError);
    expect(() => validateUsageEvent({ kind: 'start_click', value: 'a b' })).toThrow(
      FeedValidationError
    );
    expect(() => validateUsageEvent({ kind: 'start_click', value: 'x'.repeat(17) })).toThrow(
      FeedValidationError
    );
  });

  it('source sheet: opened (where), seconds played, full view, closed (how)', () => {
    const ok: Array<[string, string | null]> = [
      ['source_sheet_open', 'body'],
      ['source_sheet_open', 'note'],
      ['source_sheet_watch', '1'],
      ['source_sheet_watch', '35999'],
      ['source_sheet_full', null],
      ['source_sheet_close', 'outside'],
      ['source_sheet_close', 'back'],
    ];
    for (const [kind, value] of ok) {
      expect(validateUsageEvent({ kind, video_id: 'aaaaaaaaaaa', value })).toEqual({
        kind,
        cell: null,
        seen_date: null,
        video_id: 'aaaaaaaaaaa',
        value,
      });
    }
    expect(() => validateUsageEvent({ kind: 'source_sheet_watch', value: '1.5' })).toThrow(
      FeedValidationError
    );
  });

  it('every kind fits the kind column (varchar 32)', () => {
    for (const kind of USAGE_EVENT_KINDS) expect(kind.length).toBeLessThanOrEqual(32);
  });

  it('records a landing event as one append-only row', async () => {
    const calls: unknown[][] = [];
    const db = {
      $queryRawUnsafe: jest.fn(),
      $executeRawUnsafe: jest.fn(async (...args: unknown[]) => {
        calls.push(args);
        return 1;
      }),
    } as unknown as FeedDb;
    await recordUsageEvent(db, USER, validateUsageEvent({ kind: 'login_done' }));
    expect(calls).toHaveLength(1);
    expect(String(calls[0]![0])).toMatch(/INSERT INTO public\.morning_usage_events/);
    expect(calls[0]!.slice(1)).toEqual([USER, 'login_done', null, null, null, null]);
  });
});
