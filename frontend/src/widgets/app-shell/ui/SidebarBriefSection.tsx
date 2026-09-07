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
import { cn } from '@/shared/lib/utils';

interface SidebarBriefSectionProps {
  issue: IssueDocument | null;
  loading: boolean;
  collapsed: boolean;
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

export function SidebarBriefSection({ issue, loading, collapsed }: SidebarBriefSectionProps) {
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
      <div className="px-2.5 pb-3 pt-1">
        <div className="text-[14px] font-bold leading-snug text-sidebar-foreground">
          {issue.category} {issue.issueLabel}
        </div>
        {subtitle && (
          <div className="mt-1 text-[11.5px] leading-relaxed text-sidebar-foreground/50">
            {subtitle}
          </div>
        )}
      </div>

      <div className="border-t border-sidebar-border/50 pt-1.5">
        {entries.map((e, i) => {
          const showKicker = e.kicker && e.kicker !== entries[i - 1]?.kicker;
          return (
            <div key={`${e.label}-${i}`}>
              {showKicker && (
                <div className="px-2.5 pb-0.5 pt-2.5 text-[10.5px] font-semibold uppercase tracking-widest text-sidebar-foreground/45">
                  {e.kicker}
                </div>
              )}
              <button
                type="button"
                onClick={() => scrollToHeading(e.label)}
                className={cn(
                  'w-full rounded-md px-2.5 py-1.5 text-left text-[13px] leading-snug',
                  'transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-foreground',
                  e.depth === 0
                    ? 'font-medium text-sidebar-foreground/80'
                    : 'text-sidebar-foreground/65'
                )}
              >
                {e.label}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
