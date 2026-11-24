import { useEffect, useState, type CSSProperties } from 'react';

import { BackButton } from '@/features/morning-feed/BackButton';
import { briefDateLabel, pastHeadlinePx } from '@/features/morning-feed/watch-home-model';
import type { Frame } from '@/features/morning-feed/watch-r3-layout';
import {
  AccountButton,
  AccountSheet,
  type R3AccountView,
} from '@/features/morning-feed/watch-r3-screens';
import './watch-home.css';
import './watch-page.css';

/*
 * 지난 브리프 목록 (was 지난 장) (design handoff "design_handoff_insighta_page", PastPhone.dc.html): one domain's
 * pages newest first, the eight domain chips fixed at the bottom. A domain without pages shows
 * its name and an empty list (no empty-state screen, decision 2026-11-14).
 */

export interface PastRow {
  seen_date: string;
  headline: string;
}

export interface WatchPastProps {
  frame: Frame & { width: number };
  account?: R3AccountView;
  chips: Array<{ cell: string; title: string }>;
  initial: string;
  /** The pages of a domain, newest first. */
  load: (cell: string) => Promise<PastRow[]>;
  onOpen: (cell: string, seenDate: string) => void;
  /** Top left: back to the screen this came from ("‹ 홈"). */
  back: { label: string; onBack: () => void };
  /** Today ('YYYY-MM-DD'): a brief of that date reads '오늘 · …'. */
  today: string;
}

const NARROW_W = 360;

export function WatchPast(p: WatchPastProps): JSX.Element {
  const [sel, setSel] = useState(p.initial);
  const [rows, setRows] = useState<PastRow[]>([]);
  const [acct, setAcct] = useState(false);
  useEffect(() => {
    let on = true;
    setRows([]);
    p.load(sel)
      .then((r) => on && setRows(r))
      .catch(() => on && setRows([]));
    return () => {
      on = false;
    };
    // the loader is stable for the visit
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sel]);
  const title = p.chips.find((c) => c.cell === sel)?.title ?? sel;
  const fs = pastHeadlinePx(p.frame.width);
  return (
    <div
      className="mf-w3-root mf-home mf-page mf-past"
      data-testid="mf-past"
      data-narrow={p.frame.width < NARROW_W ? '' : undefined}
      style={
        {
          '--w3-safe-top': p.frame.safeTop + 'px',
          '--w3-safe-bottom': p.frame.safeBottom + 'px',
        } as CSSProperties
      }
    >
      <div className="mf-home-col">
        <div className="mf-page-top">
          <BackButton label={p.back.label} onBack={p.back.onBack} testId="mf-past-home" />
          {p.account ? <AccountButton account={p.account} onOpen={() => setAcct(true)} /> : null}
        </div>
        <div className="mf-past-list">
          <div className="mf-past-dom" data-testid="mf-past-dom">
            {title}
          </div>
          {rows.map((r) => (
            <button
              key={r.seen_date}
              type="button"
              className="mf-past-row"
              data-press="row"
              data-testid="mf-past-row"
              onClick={() => p.onOpen(sel, r.seen_date)}
            >
              <div className="mf-past-date">{briefDateLabel(r.seen_date, p.today)}</div>
              <div className="mf-past-head" style={{ fontSize: fs + 'px' }}>
                {r.headline}
              </div>
            </button>
          ))}
        </div>
        <div className="mf-home-chips">
          {p.chips.map((c) => (
            <button
              key={c.cell}
              type="button"
              className="mf-home-chip"
              data-press="btn"
              data-testid="mf-past-chip"
              data-on={c.cell === sel ? '' : undefined}
              onClick={() => setSel(c.cell)}
            >
              {c.title}
            </button>
          ))}
        </div>
      </div>
      {acct && p.account ? (
        <AccountSheet account={p.account} onClose={() => setAcct(false)} />
      ) : null}
    </div>
  );
}
