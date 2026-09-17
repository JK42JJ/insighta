/**
 * The brief page's right panel: the same column the learning page shows
 * beside a video.
 *
 * Structure, width and classes follow `pages/learning/ui/RightPanel.tsx`: a
 * 400px column with the sidebar's divider, a 52px context zone naming what
 * the chat applies to ("지금 읽는 브리프 · 제1호"), the tab row, the chat, and
 * the disclaimer line under it. It is always open, as the learning page's is;
 * on a narrow desktop the shell collapses the left sidebar to make room
 * (AppShell, the same rule /learning uses).
 *
 * A phone cannot hold a reading column and a 400px panel side by side, so
 * below `md` the panel is a bottom sheet opened from a button.
 */

import { Suspense, lazy, useState } from 'react';
import { Bot } from 'lucide-react';

import type { IssueDocument } from '@/features/newsletter-note/lib/issue-types';
import { Sheet, SheetContent, SheetTitle } from '@/shared/ui/sheet';
import { useMediaQuery } from '@/shared/hooks/useMediaQuery';

// Loaded after the page, not with it: the chat carries the CopilotKit runtime
// and UI, which otherwise land in the main chunk (the brief page is not a
// lazy route) and push it past the service worker's precache limit
// (measured 2026-09-16: 4.27 MB).
const BriefAskPanel = lazy(() =>
  import('./BriefAskPanel').then((m) => ({ default: m.BriefAskPanel }))
);

/** Same breakpoint split the rest of the shell uses for desktop vs phone. */
const DESKTOP_QUERY = '(min-width: 768px)';

const TAB_LABEL = 'AI 챗봇';
const CONTEXT_PREFIX = '지금 읽는 브리프';
const DISCLAIMER = '챗봇은 실수할 수 있습니다. 답변을 다시 확인하세요.';

/** `VITE_BRIEF_ASK=false` at build time removes the panel without a code change. */
export const BRIEF_ASK_ENABLED = import.meta.env.VITE_BRIEF_ASK !== 'false';

function ChatLoading(): JSX.Element {
  return <p className="px-1 py-6 text-[13px] text-muted-foreground">불러오는 중…</p>;
}

/** Context zone + tab row + chat + disclaimer, shared by the column and the sheet. */
function PanelBody({ issue }: { issue: IssueDocument }): JSX.Element {
  return (
    <>
      <div className="flex h-[52px] shrink-0 items-center border-b border-sidebar-border/40 px-1 text-[12px] text-muted-foreground/60">
        <span className="shrink-0">{CONTEXT_PREFIX}</span>
        <span className="shrink-0 px-1.5" aria-hidden>
          ·
        </span>
        <span className="min-w-0 truncate text-foreground/75">
          {issue.category} {issue.issueLabel}
        </span>
      </div>

      <div className="flex shrink-0" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected="true"
          className="flex flex-1 items-center justify-center gap-1.5 border-b-2 border-primary py-2.5 text-[12px] font-semibold text-foreground"
        >
          <Bot className="h-3.5 w-3.5" aria-hidden="true" />
          {TAB_LABEL}
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={<ChatLoading />}>
            <BriefAskPanel issue={issue} />
          </Suspense>
        </div>
        <p className="w-full shrink-0 py-2 text-center text-[10px] text-muted-foreground/60">
          {DISCLAIMER}
        </p>
      </div>
    </>
  );
}

export function BriefAskDock({ issue }: { issue: IssueDocument }): JSX.Element {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const [sheetOpen, setSheetOpen] = useState(false);

  if (desktop) {
    return (
      <aside
        aria-label={TAB_LABEL}
        // Same classes as the learning page's RightPanel: width, divider,
        // and the 5px top offset that lines the context zone up with the
        // sidebar's first row.
        className="flex w-[400px] shrink-0 flex-col border-l border-sidebar-border/40 pl-5 pr-5 pt-[5px]"
      >
        <PanelBody issue={issue} />
      </aside>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        aria-label={`${TAB_LABEL} 열기`}
        className="fixed bottom-6 right-5 z-40 flex items-center gap-1.5 rounded-full border border-border bg-background px-4 py-2 text-[13px] text-foreground shadow-md transition-colors hover:bg-muted"
      >
        <Bot className="h-4 w-4" aria-hidden="true" />
        {TAB_LABEL}
      </button>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="flex h-[75vh] flex-col px-4 pb-0 pt-2">
          <SheetTitle className="sr-only">{TAB_LABEL}</SheetTitle>
          <PanelBody issue={issue} />
        </SheetContent>
      </Sheet>
    </>
  );
}
