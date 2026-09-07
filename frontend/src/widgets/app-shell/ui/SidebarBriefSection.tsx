/**
 * The contents of the issue being read.
 *
 * A brief is read the way a note is read, so the sidebar does what it does
 * there: while `/learning/:mandalaId/:videoId` is open, the mandala list gives
 * way to that note's table of contents. Reading a brief with a list of
 * mandalas beside it was the one place that rule was not applied.
 *
 * The entries come out of the `IssueDocument` and nothing is stored for them.
 * `stories[].kicker` already holds a chapter name — 신뢰 경계, 권한의 시점,
 * 운영, 비용 — so the two-level shape the note uses is already in the data.
 *
 * Not shared with `SidebarLearningSection`, deliberately. That one reads
 * `mandala_book` chapters; this reads an issue. Sharing a component across two
 * different shapes produces one that fits neither, so the look is matched and
 * the code is not.
 *
 * Clicking scrolls. Highlighting the section the reader is currently in needs
 * scroll tracking, which the note has and this does not yet — it is worth
 * adding once these links are shown to be used, not before.
 */

import { useMemo } from 'react';

import type { IssueDocument } from '@/features/newsletter-note/lib/issue-types';
import { tocShortLabel } from '@/pages/learning/lib/toc-label';
import { cn } from '@/shared/lib/utils';

interface SidebarBriefSectionProps {
  issue: IssueDocument | null;
  loading: boolean;
  collapsed: boolean;
  /**
   * Which entry the reader jumped to, owned by the sidebar rather than here.
   *
   * The note keeps the same thing in `useLearningStore` for the same reason:
   * `useBriefNote` refetches, the issue object changes identity, and a
   * `useState` in this component loses the selection on the re-render -- the
   * gold marker appeared and vanished within a frame.
   */
  active: string | null;
  onSelect: (label: string) => void;
}

interface Entry {
  /** The heading text, which is also how the anchor is found in the page. */
  label: string;
  /** A story's kicker, rendered as the group above its title. */
  kicker?: string;
  depth: 0 | 1;
}

/**
 * The entries, in the order `issueToNoteDoc` assembles the page.
 *
 * Kept in step with that function by construction: each branch here mirrors a
 * conditional there, so a section that does not render also does not appear in
 * the contents. A hardcoded list would drift the first time a section became
 * optional.
 */
function toEntries(doc: IssueDocument): Entry[] {
  const out: Entry[] = [];
  for (const s of doc.stories) out.push({ label: s.title, kicker: s.kicker, depth: 1 });
  out.push({ label: '이번 주 한 문장', depth: 0 });
  if (doc.picks.length > 0) out.push({ label: '이번 주 추천', depth: 0 });
  if (doc.vocabulary.length > 0) out.push({ label: '용어', depth: 0 });
  out.push({ label: '이 브리프를 만든 방법', depth: 0 });
  if (doc.refs.length > 0) out.push({ label: '출처', depth: 1 });
  return out;
}

/**
 * Scroll to the heading whose text matches.
 *
 * Matching on text rather than an id because the note editor renders the
 * document; adding ids would mean teaching the converter about anchors for the
 * benefit of one sidebar. The headings within an issue are unique — the schema
 * gives each story its own title — so the text is the identifier.
 *
 * The container is moved directly rather than by `scrollIntoView`. The reading
 * surface scrolls inside a nested `overflow-y-auto` while the document itself
 * does not scroll at all, and `scrollIntoView` on a heading in that layout did
 * nothing at all — measured, with the target 6,417px below the fold and
 * `scrollTop` still 0 afterwards.
 */
const SCROLL_TOP_MARGIN = 24;

function scrollToHeading(label: string): void {
  const root = document.querySelector('.note-prose-root');
  const scroller = root?.parentElement;
  if (!root || !scroller) return;

  for (const h of root.querySelectorAll('h1, h2, h3')) {
    if ((h.textContent ?? '').trim() !== label) continue;
    const top =
      h.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop -
      SCROLL_TOP_MARGIN;
    // Instant, not smooth. Measured in the browser: `scrollTo` with
    // `behavior: 'smooth'` on this container does nothing at all -- asked for
    // 3,000px, `scrollTop` stayed 0 -- while `behavior: 'auto'` lands exactly.
    // `prefers-reduced-motion` was off, so it is the container, not the
    // setting. An animation nobody sees is worse than a jump they do.
    // Instant, not smooth. Measured in this container: `scrollTo` with
    // `behavior: 'smooth'` moves nothing -- asked for 3,000px and `scrollTop`
    // stayed 0, with `prefers-reduced-motion` off -- while `auto` lands
    // exactly. An animation nobody sees is worse than a jump they do.
    scroller.scrollTo({ top, behavior: 'auto' });
    return;
  }
}

export function SidebarBriefSection({
  issue,
  loading,
  collapsed,
  active,
  onSelect,
}: SidebarBriefSectionProps) {
  const entries = useMemo(() => (issue ? toEntries(issue) : []), [issue]);

  if (collapsed) return null;

  if (loading) {
    return <div className="px-3 py-2 text-[13px] text-sidebar-foreground/50">불러오는 중…</div>;
  }
  if (!issue) return null;

  // The runline leads with the reading time and the corpus size; the first
  // segment is the one that belongs under a title.
  const subtitle = issue.runline.split('·').slice(1).join(' ·').trim();

  return (
    <div className="px-1 flex flex-col">
      <div className="px-2 py-2">
        <h3 className="truncate text-[14px] font-bold leading-snug text-sidebar-foreground">
          {issue.category} {issue.issueLabel}
        </h3>
        {subtitle && (
          <p className="mt-0.5 truncate text-[13px] text-sidebar-foreground/50">{subtitle}</p>
        )}
      </div>

      <div className="border-t border-sidebar-border/50 pt-1.5">
        {entries.map((e, i) => {
          const showKicker = e.kicker && e.kicker !== entries[i - 1]?.kicker;
          const isActive = active === e.label;
          return (
            <div key={`${e.label}-${i}`} className="mb-0.5">
              {/* Chapter row: bullet + uppercase kicker, exactly the note's. */}
              {showKicker && (
                <div className="group flex w-full items-center gap-2 px-2 py-1 text-left">
                  <span className="shrink-0 text-[11px] leading-[1.5] text-sidebar-foreground/35">
                    •
                  </span>
                  <span className="flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.10em] text-sidebar-foreground/55">
                    {tocShortLabel(e.kicker!)}
                  </span>
                </div>
              )}
              <ul className={cn(showKicker && 'ml-3.5 pt-0.5')}>
                <li
                  onClick={() => {
                    onSelect(e.label);
                    scrollToHeading(e.label);
                  }}
                  // Size and colour are both `text-*`, so the order within each
                  // branch is what `twMerge` keeps. Same ordering as the note's
                  // TOC, which is where this markup comes from.
                  className={cn(
                    'cursor-pointer truncate pl-3.5 py-1.5 leading-[1.5] transition-colors',
                    isActive
                      ? 'border-l-2 border-sidebar-primary text-[14px] font-medium text-sidebar-primary'
                      : 'border-l border-sidebar-foreground/10 text-[13px] text-sidebar-foreground/50 hover:border-sidebar-foreground/50 hover:text-sidebar-foreground'
                  )}
                >
                  {tocShortLabel(e.label)}
                </li>
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}
