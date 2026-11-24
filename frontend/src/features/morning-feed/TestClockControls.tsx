import { useState } from 'react';

import { postTestClock, type TestClockDto } from '@/features/morning-cards/api';
import { seenDateLabel } from '@/features/morning-feed/watch-home-model';

/*
 * Virtual today in the account sheet (stg repeat tests, decision 2026-11-14). Shown only when the
 * server says this account may use it (GET /test-clock answers; 404 for everyone else and in prod).
 * A change reloads the watch screen, so the home is drawn again for the new day.
 */
export function TestClockControls({ clock }: { clock: TestClockDto }): JSX.Element {
  const [busy, setBusy] = useState(false);
  const go = (action: 'next' | 'reset'): void => {
    if (busy) return;
    setBusy(true);
    postTestClock(action)
      .then(() => window.location.assign('/morning-cards?view=watch'))
      .catch(() => setBusy(false));
  };
  return (
    <div className="mf-clock" data-testid="mf-test-clock">
      <div className="mf-clock-day" data-testid="mf-test-clock-day">
        {clock.day
          ? '가상 날짜 ' + seenDateLabel(clock.day)
          : '실제 날짜 ' + seenDateLabel(clock.real)}
      </div>
      <div className="mf-clock-row">
        <button
          type="button"
          className="mf-clock-btn"
          data-press="btn"
          data-testid="mf-test-clock-next"
          disabled={busy}
          onClick={() => go('next')}
        >
          다음 날로
        </button>
        <button
          type="button"
          className="mf-clock-btn"
          data-press="btn"
          data-testid="mf-test-clock-reset"
          disabled={busy || !clock.day}
          onClick={() => go('reset')}
        >
          실제 날짜로 되돌리기
        </button>
      </div>
    </div>
  );
}
