import type { Ref } from 'react';

import { seenDateLabel } from '@/features/morning-feed/watch-home-model';
import { AccountButton, type R3AccountView } from '@/features/morning-feed/watch-r3-screens';
import { BrandLogo } from '@/shared/ui/brand-logo';
import './watch-home.css';

/*
 * The home's head (decision 2026-11-25): what is rarely used sits at the very top, in two rows:
 * "Insighta" and the account, then the date of the shown brief, which opens the past briefs. Both
 * texts are buttons with the landing header's press feel ('soft', use-press.ts).
 */
export function HomeHead({
  account,
  onAccount,
  day,
  onDate,
  hidden = false,
  dateRef,
}: {
  account?: R3AccountView;
  onAccount: () => void;
  /** The date shown ('YYYY-MM-DD'). */
  day: string;
  /** Past briefs; absent = the date is text only (nothing to open). */
  onDate?: () => void;
  /** The date row keeps its place until the fonts are in. */
  hidden?: boolean;
  dateRef?: Ref<HTMLDivElement>;
}): JSX.Element {
  const label = <span data-testid="mf-home-seen">{seenDateLabel(day)}</span>;
  return (
    <>
      <div className="mf-home-top">
        {/* already the home: the press shows, nothing moves */}
        <button
          type="button"
          className="mf-w3-brand mf-home-brand"
          data-press="soft"
          data-testid="mf-home-brand"
        >
          <BrandLogo />
        </button>
        {account ? <AccountButton account={account} onOpen={onAccount} /> : null}
      </div>
      <div
        className="mf-home-date-row"
        ref={dateRef}
        style={{ visibility: hidden ? 'hidden' : 'visible' }}
      >
        {onDate ? (
          <button
            type="button"
            className="mf-home-date"
            data-press="soft"
            data-testid="mf-home-past"
            onClick={onDate}
          >
            {label}
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 5l4 4 4-4" />
            </svg>
          </button>
        ) : (
          <div className="mf-home-date">{label}</div>
        )}
      </div>
    </>
  );
}
