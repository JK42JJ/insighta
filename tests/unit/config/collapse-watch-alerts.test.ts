/**
 * Collapse-watch alert-state semantics (perf-monitor PR4).
 * Pure state-machine tests — no DB, no mailer.
 */
import { shouldAlert, clearResolved, isCollapseWatchEnabled } from '@/config/collapse-watch';

function freshState() {
  return { lastAlertAt: new Map<string, number>(), firstSeenAt: new Map<string, number>() };
}

const H = 3600 * 1000;

describe('collapse-watch alert state', () => {
  it('flag defaults off', () => {
    expect(isCollapseWatchEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(isCollapseWatchEnabled({ COLLAPSE_WATCH_ENABLED: 'true' } as NodeJS.ProcessEnv)).toBe(
      true
    );
  });

  it('first violation alerts immediately, repeat within 6h cooldown suppressed', () => {
    const st = freshState();
    const t0 = 1_000_000;
    expect(shouldAlert('hit_rate', t0, st).alert).toBe(true);
    expect(shouldAlert('hit_rate', t0 + 1 * H, st).alert).toBe(false);
    expect(shouldAlert('hit_rate', t0 + 5 * H, st).alert).toBe(false);
    expect(shouldAlert('hit_rate', t0 + 6 * H, st).alert).toBe(true);
  });

  it('unresolved violation escalates with day count (supervisor: daily re-send)', () => {
    const st = freshState();
    const t0 = 1_000_000;
    expect(shouldAlert('cards_p50', t0, st)).toEqual({ alert: true, escalationDays: 0 });
    const day1 = shouldAlert('cards_p50', t0 + 25 * H, st);
    expect(day1.alert).toBe(true);
    expect(day1.escalationDays).toBe(1);
    const day2 = shouldAlert('cards_p50', t0 + 49 * H, st);
    expect(day2.escalationDays).toBe(2);
  });

  it('resolution clears state → next occurrence alerts fresh (day 0)', () => {
    const st = freshState();
    const t0 = 1_000_000;
    shouldAlert('shorts_1h', t0, st);
    clearResolved(new Set(), st); // no active violations → clear
    const again = shouldAlert('shorts_1h', t0 + 1 * H, st);
    expect(again).toEqual({ alert: true, escalationDays: 0 });
  });

  it('clearResolved keeps still-active metrics', () => {
    const st = freshState();
    shouldAlert('a', 0, st);
    shouldAlert('b', 0, st);
    clearResolved(new Set(['a']), st);
    expect(st.firstSeenAt.has('a')).toBe(true);
    expect(st.firstSeenAt.has('b')).toBe(false);
  });
});
