/**
 * Where the "ask about this issue" panel lives on the brief page.
 *
 * Closed by default: the page is a reading column, and a permanently open
 * chat beside it turns a magazine into a console. A button at the right
 * edge opens it. Where the viewport holds the sidebar (320), the column
 * (720) and the panel (400) together, the panel is a right column the page
 * owns, as the learning page's right panel is; narrower than that it is a
 * sheet over the page — from the right on a laptop, from the bottom on a
 * phone — so the column never shrinks under it.
 */

import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { MessageSquare, X } from 'lucide-react';

import type { IssueDocument } from '@/features/newsletter-note/lib/issue-types';
import { Sheet, SheetContent, SheetTitle } from '@/shared/ui/sheet';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';

// Loaded when the panel opens, not with the page: the panel carries the
// CopilotKit runtime and UI, which otherwise land in the main bundle and
// push it past the service worker's precache limit (measured: 4.27 MB).
const BriefAskPanel = lazy(() =>
  import('./BriefAskPanel').then((m) => ({ default: m.BriefAskPanel }))
);

function PanelLoading(): JSX.Element {
  return <p className="px-4 py-6 text-[13px] text-muted-foreground">불러오는 중…</p>;
}

/** Sidebar 320 + reading column 720 + panel 400. */
const WIDE_QUERY = '(min-width: 1440px)';
/** Below this the sheet comes from the bottom rather than the right. */
const RIGHT_SHEET_QUERY = '(min-width: 640px)';

const PANEL_TITLE = '이 호에 질문';
const OPEN_LABEL = '질문';

/** Per-viewer convenience only; the page works without it. */
const OPEN_STATE_KEY = 'brief-ask-open';

/** Set `VITE_BRIEF_ASK=false` at build time to hide the dock without a code change. */
export const BRIEF_ASK_ENABLED = import.meta.env.VITE_BRIEF_ASK !== 'false';

function readOpenState(): boolean {
  try {
    return window.localStorage.getItem(OPEN_STATE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeOpenState(open: boolean): void {
  try {
    window.localStorage.setItem(OPEN_STATE_KEY, open ? '1' : '0');
  } catch {
    // Storage unavailable (private window, blocked). The state is in memory.
  }
}

export function BriefAskDock({ issue }: { issue: IssueDocument }): JSX.Element {
  const [open, setOpen] = useState(readOpenState);
  const wide = useMediaQuery(WIDE_QUERY);
  const rightSheet = useMediaQuery(RIGHT_SHEET_QUERY);

  useEffect(() => writeOpenState(open), [open]);
  const close = useCallback(() => setOpen(false), []);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        aria-label={`${PANEL_TITLE} 열기`}
        className="fixed bottom-6 right-5 z-40 flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-[13px] text-foreground shadow-md transition-colors hover:bg-muted"
      >
        <MessageSquare className="h-4 w-4" aria-hidden="true" />
        {OPEN_LABEL}
      </button>
    );
  }

  if (wide) {
    return (
      <aside
        aria-label={PANEL_TITLE}
        className="flex h-full w-[400px] shrink-0 flex-col border-l border-sidebar-border/40 bg-background"
      >
        <div className="flex h-[52px] shrink-0 items-center justify-between border-b border-border/60 px-4">
          <h2 className="text-[13px] font-semibold">{PANEL_TITLE}</h2>
          <button
            type="button"
            onClick={close}
            aria-label={`${PANEL_TITLE} 닫기`}
            className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <Suspense fallback={<PanelLoading />}>
            <BriefAskPanel issue={issue} />
          </Suspense>
        </div>
      </aside>
    );
  }

  return (
    <Sheet open onOpenChange={(next) => setOpen(next)}>
      <SheetContent
        side={rightSheet ? 'right' : 'bottom'}
        className={rightSheet ? 'w-[400px] p-0 sm:max-w-[400px]' : 'h-[70vh] p-0'}
      >
        <SheetTitle className="sr-only">{PANEL_TITLE}</SheetTitle>
        <div className="h-full min-h-0">
          <Suspense fallback={<PanelLoading />}>
            <BriefAskPanel issue={issue} />
          </Suspense>
        </div>
      </SheetContent>
    </Sheet>
  );
}
