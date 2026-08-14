/**
 * KST calendar helpers for the weekly curation schedule (2026-07-27).
 *
 * These lock the two boundaries the UTC implementation got wrong:
 *  - 15:00 UTC is midnight KST, so the KST day flips there, not at 00:00 UTC.
 *  - At the Monday-morning-KST scan (Sun 23:17 UTC) the week key must be THIS
 *    Monday. The old UTC helper returned the PREVIOUS Monday, which would have
 *    made a Monday build overwrite last week's snapshot.
 */

import {
  kstDow,
  kstWeekStart,
  kstWeekStartInstant,
  utcWeekStart,
  nextKstWeekdayAt,
  isValidWeekday,
} from '../../src/utils/kst';

describe('kstDow', () => {
  it('flips the day at 15:00 UTC (KST midnight), not at 00:00 UTC', () => {
    // 2026-07-27 is a Monday. 14:59Z is still Monday 23:59 KST.
    expect(kstDow(new Date('2026-07-27T14:59:59Z'))).toBe(1);
    // 15:00Z is Tuesday 00:00 KST.
    expect(kstDow(new Date('2026-07-27T15:00:00Z'))).toBe(2);
  });

  it('reads the scan moment (Sun 23:17 UTC) as Monday in KST', () => {
    expect(kstDow(new Date('2026-07-26T23:17:03Z'))).toBe(1);
  });

  it('covers every weekday', () => {
    // 2026-07-26 is a Sunday; walk a full KST week from Monday 00:00 KST.
    const monday = new Date('2026-07-26T15:00:00Z'); // Mon 00:00 KST
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getTime() + i * 24 * 60 * 60 * 1000);
      expect(kstDow(d)).toBe((1 + i) % 7);
    }
  });
});

describe('kstWeekStart', () => {
  it('returns THIS Monday at the scan moment — the defect the UTC helper had', () => {
    const scan = new Date('2026-07-26T23:17:03Z'); // Mon 08:17 KST
    expect(kstWeekStart(scan)).toBe('2026-07-27');
    // the shipped UTC helper resolved the same instant to the previous week
    expect(utcWeekStart(scan)).toBe('2026-07-20');
  });

  it('holds the same key across a whole KST week', () => {
    const monday = new Date('2026-07-26T15:00:00Z'); // Mon 00:00 KST
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday.getTime() + i * 24 * 60 * 60 * 1000);
      expect(kstWeekStart(d)).toBe('2026-07-27');
    }
    // one minute into the next KST week
    expect(kstWeekStart(new Date('2026-08-02T15:00:00Z'))).toBe('2026-08-03');
  });

  it('treats Sunday as the END of the KST week, not the start', () => {
    // Sunday 2026-08-02 12:00 KST
    expect(kstWeekStart(new Date('2026-08-02T03:00:00Z'))).toBe('2026-07-27');
  });
});

describe('kstWeekStartInstant', () => {
  it('is 00:00 KST = 15:00 UTC the previous day', () => {
    const inst = kstWeekStartInstant(new Date('2026-07-27T02:00:00Z'));
    expect(inst.toISOString()).toBe('2026-07-26T15:00:00.000Z');
  });

  it('makes "built this week already" comparable', () => {
    const now = new Date('2026-07-27T02:00:00Z');
    const start = kstWeekStartInstant(now);
    const lastWeeksRun = new Date('2026-07-20T05:00:00Z');
    const thisWeeksRun = new Date('2026-07-27T01:00:00Z');
    expect(lastWeeksRun < start).toBe(true); // due
    expect(thisWeeksRun < start).toBe(false); // already built
  });
});

describe('nextKstWeekdayAt', () => {
  const H = 8;
  const M = 17;

  it('lands on the requested weekday at the delivery slot, in KST', () => {
    const from = new Date('2026-07-27T02:00:00Z'); // Mon 11:00 KST
    const next = nextKstWeekdayAt(3, from, H, M); // Wednesday
    expect(kstDow(next)).toBe(3);
    // 08:17 KST == 23:17 UTC the previous day
    expect(next.toISOString()).toBe('2026-07-28T23:17:00.000Z');
  });

  it('rolls to next week when today is the day but the slot has passed', () => {
    const from = new Date('2026-07-27T02:00:00Z'); // Mon 11:00 KST, past 08:17
    const next = nextKstWeekdayAt(1, from, H, M);
    expect(kstDow(next)).toBe(1);
    expect(kstWeekStart(next)).toBe('2026-08-03');
  });

  it('stays today when the slot is still ahead', () => {
    const from = new Date('2026-07-26T22:00:00Z'); // Mon 07:00 KST, before 08:17
    const next = nextKstWeekdayAt(1, from, H, M);
    expect(next.toISOString()).toBe('2026-07-26T23:17:00.000Z');
  });

  it('always produces a future instant for every weekday', () => {
    const from = new Date('2026-07-27T02:00:00Z');
    for (let w = 0; w < 7; w++) {
      const next = nextKstWeekdayAt(w, from, H, M);
      expect(next.getTime()).toBeGreaterThan(from.getTime());
      expect(kstDow(next)).toBe(w);
    }
  });
});

describe('isValidWeekday', () => {
  it('accepts 0..6 only', () => {
    for (let i = 0; i <= 6; i++) expect(isValidWeekday(i)).toBe(true);
    expect(isValidWeekday(-1)).toBe(false);
    expect(isValidWeekday(7)).toBe(false);
    expect(isValidWeekday(1.5)).toBe(false);
    expect(isValidWeekday('1')).toBe(false);
    expect(isValidWeekday(null)).toBe(false);
    expect(isValidWeekday(undefined)).toBe(false);
  });
});
