/**
 * The ten briefs, as a menu you switch on and off.
 *
 * The first version listed only what the reader already took and put the other
 * nine behind a `+ 브리프 추가` link that opened a separate subscription page.
 * Three things were wrong with that and they had one cause.
 *
 *   `+` means "make one" everywhere else here — `새 만다라` makes a mandala.
 *   Nothing is made by this control: there are exactly ten briefs, fixed, and
 *   a reader turns one on. Same glyph, different act.
 *
 *   Ten items that never change are not a list worth hiding. Hiding them made
 *   the product look like it had one brief, and made finding the others a trip
 *   out of the sidebar.
 *
 *   The page that trip led to stacked two unrelated lists — issues received
 *   and subscriptions available — and was neither.
 *
 * All ten are here now, and subscribing happens on the row the reader is
 * already looking at. The row markup follows `SidebarSkillPanel`: same green
 * dot for on, same disabled treatment and badge for what is not available yet.
 * That panel is this product's existing answer to "a menu of things you switch
 * on", and a second answer would be a second thing to learn.
 *
 * Which briefs are available is read from the data, not listed here: one with
 * no published issue is not something to subscribe to, and that is exactly the
 * `issues === 0` the API already reports. When the second brief publishes, its
 * row turns on by itself.
 */

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Loader2 } from 'lucide-react';

import {
  apiClient,
  type SubscribedBriefIssue,
  type BriefCategoryRow,
} from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/utils';

interface SidebarBriefEntryProps {
  collapsed: boolean;
}

interface DomainRow extends BriefCategoryRow {
  /** Published issues this reader has not opened. */
  unread: number;
  /** No issue has ever published, so there is nothing to subscribe to yet. */
  pending: boolean;
}

function toRows(categories: BriefCategoryRow[], issues: SubscribedBriefIssue[]): DomainRow[] {
  const unreadByKey = new Map<string, number>();
  for (const it of issues) {
    if (!it.read) unreadByKey.set(it.categoryKey, (unreadByKey.get(it.categoryKey) ?? 0) + 1);
  }
  return categories.map((c) => ({
    ...c,
    unread: unreadByKey.get(c.key) ?? 0,
    pending: c.issues === 0,
  }));
}

export function SidebarBriefEntry({ collapsed }: SidebarBriefEntryProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(true);

  const { data: subscribed } = useQuery({
    queryKey: ['brief-subscribed'],
    queryFn: async () => {
      const res = await apiClient.getSubscribedBriefs();
      if (res.status !== 'ok' || !res.data) throw new Error(res.error ?? 'failed');
      return res.data;
    },
    // A weekly publication does not change between renders.
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const { data: categories } = useQuery({
    queryKey: ['brief-categories'],
    queryFn: async () => {
      const res = await apiClient.getBriefCategories();
      if (res.status !== 'ok' || !res.data) throw new Error(res.error ?? 'failed');
      return res.data.categories;
    },
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const subscribe = useMutation({
    mutationFn: async (categoryKey: string) => {
      const res = await apiClient.subscribeToBrief(categoryKey);
      if (res.status !== 'ok') throw new Error(res.error ?? 'failed');
      return categoryKey;
    },
    onSuccess: (categoryKey) => {
      void queryClient.invalidateQueries({ queryKey: ['brief-categories'] });
      void queryClient.invalidateQueries({ queryKey: ['brief-subscribed'] });
      // Subscribing is how a reader says "show me this one", so showing it is
      // the answer rather than leaving them where they asked from.
      navigate(`/brief/c/${categoryKey}`);
    },
  });

  const rows = toRows(categories ?? [], subscribed?.issues ?? []);
  const unreadTotal = subscribed?.unread ?? 0;

  // The collapsed rail has no room for a list. The mandala section below does
  // the same rather than rendering a column of truncated names.
  if (collapsed) return null;

  return (
    <div className="shrink-0 px-1 flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1.5 px-1.5 py-2 rounded-lg text-[13px] font-bold text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors duration-150"
        aria-expanded={open}
      >
        <span className="flex-1 text-left">브리프</span>
        {/* The total belongs on the heading while the list is folded — folded
            is the only state where the per-row badges are invisible. */}
        {!open && unreadTotal > 0 && (
          <span className="shrink-0 rounded-full bg-sidebar-primary px-1.5 text-[10px] font-bold leading-[17px] text-sidebar-primary-foreground">
            {unreadTotal}
          </span>
        )}
        <ChevronDown
          className={cn(
            'w-3.5 h-3.5 shrink-0 text-sidebar-foreground/50 transition-transform duration-150',
            !open && '-rotate-90'
          )}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className="mt-0.5 flex flex-col">
          {rows.map((row) => {
            const href = `/brief/c/${row.key}`;
            const active = location.pathname === href;
            const busy = subscribe.isPending && subscribe.variables === row.key;

            return (
              <button
                key={row.key}
                type="button"
                disabled={row.pending || busy}
                aria-disabled={row.pending}
                aria-current={active ? 'page' : undefined}
                onClick={() => {
                  if (row.pending) return;
                  // A subscribed row opens. An unsubscribed one turns on first,
                  // so there is one action per row and no small second target
                  // to aim at. Turning a brief back off lives on its own page,
                  // where a reader who has read it decides.
                  if (row.subscribed) navigate(href);
                  else subscribe.mutate(row.key);
                }}
                className={cn(
                  'flex items-center gap-2.5 px-2.5 py-2 rounded-lg select-none',
                  'text-[13px] transition-colors duration-150',
                  row.pending
                    ? 'opacity-40 cursor-not-allowed text-sidebar-foreground/65'
                    : 'hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
                  !row.pending && active && 'bg-sidebar-accent text-sidebar-foreground',
                  !row.pending && !active && row.subscribed && 'text-sidebar-foreground/85',
                  !row.pending && !active && !row.subscribed && 'text-sidebar-foreground/65',
                  busy && 'opacity-50 pointer-events-none'
                )}
              >
                <span className="min-w-0 flex-1 text-left truncate">{row.label}</span>

                {busy && (
                  <Loader2
                    className="w-3.5 h-3.5 shrink-0 animate-spin text-sidebar-foreground/50"
                    aria-hidden="true"
                  />
                )}

                {/* Not published yet. Said rather than hidden — the list is
                    also the roadmap, and hiding what is coming makes the
                    product look smaller than it is. */}
                {row.pending && (
                  <span
                    className="shrink-0 inline-flex items-center rounded-[3px] bg-[hsl(var(--muted))] px-1.5 py-px text-[9px] font-extrabold tracking-wider text-[hsl(var(--muted-foreground))]"
                    aria-label="준비 중"
                  >
                    TBD
                  </span>
                )}

                {/* Unread wins the slot over the on-dot: a reader with unread
                    issues already knows they are subscribed. */}
                {!row.pending && !busy && row.unread > 0 && (
                  <span className="shrink-0 rounded-full bg-sidebar-primary px-1.5 text-[10px] font-bold leading-[16px] text-sidebar-primary-foreground">
                    {row.unread}
                  </span>
                )}
                {!row.pending && !busy && row.unread === 0 && row.subscribed && (
                  <span
                    className="w-1.5 h-1.5 shrink-0 rounded-full bg-emerald-500"
                    aria-label="구독 중"
                  />
                )}
                {!row.pending && !busy && !row.subscribed && (
                  <span className="shrink-0 text-[11.5px] text-sidebar-foreground/45">구독</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
