/**
 * The ten briefs, behind one row.
 *
 * They were listed inline, all ten, which pushed the mandala list down by ten
 * rows and cut it off — twelve mandalas, ten visible. Nine of those rows were
 * `TBD` and could not be clicked, so what could not be used was hiding what
 * could.
 *
 * `더 보기` in the top section already solves this: the sidebar gives up one
 * row and the list opens to the right, over the content area rather than over
 * the mandalas. This is the same Popover with the same placement.
 *
 * The rows inside follow `SidebarSkillPanel`, which is this product's existing
 * answer to "a menu of things you switch on": a green dot for on, a dimmed row
 * and a badge for what is not available yet. A brief's `TBD` sits where that
 * panel's `PRO` sits and means the same thing — not yet.
 *
 * What is available is read from the data (`issues === 0`), not listed here,
 * so the second brief turns its own row on when it publishes.
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Loader2, Newspaper } from 'lucide-react';

import {
  apiClient,
  type SubscribedBriefIssue,
  type BriefCategoryRow,
} from '@/shared/lib/api-client';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
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
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

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
      setOpen(false);
      navigate(`/brief/c/${categoryKey}`);
    },
  });

  const rows = toRows(categories ?? [], subscribed?.issues ?? []);
  const unreadTotal = subscribed?.unread ?? 0;

  // The collapsed rail has no room for a label. The mandala section below does
  // the same rather than rendering a truncated one.
  if (collapsed) return null;

  return (
    <div className="shrink-0 px-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            // Same metrics as the mandala section header directly below, so the
            // two hover boxes line up. That section sits inside a `px-1` nav as
            // well as its own `px-1`, which is why this one carries `mx-1`:
            // matching the class string alone leaves it 4px wider on each side.
            className="mx-1 w-[calc(100%-0.5rem)] flex items-center gap-1.5 px-1.5 py-2 rounded-lg text-[13px] font-bold text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors duration-150"
          >
            <span className="flex-1 text-left">브리프</span>
            {unreadTotal > 0 && (
              <span className="shrink-0 rounded-full bg-sidebar-primary px-1.5 text-[10px] font-bold leading-[17px] text-sidebar-primary-foreground">
                {unreadTotal}
              </span>
            )}
            <ChevronRight
              className={cn(
                'w-3.5 h-3.5 shrink-0 text-sidebar-foreground/50 transition-transform duration-150',
                open && 'rotate-90'
              )}
              aria-hidden="true"
            />
          </button>
        </PopoverTrigger>

        <PopoverContent
          side="right"
          align="start"
          sideOffset={8}
          className="w-72 p-1.5 max-h-[80vh] overflow-y-auto"
        >
          <div className="flex items-center gap-2 px-2.5 pb-1.5 pt-1">
            <Newspaper
              className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/50"
              aria-hidden="true"
            />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-sidebar-foreground/50">
              주간 브리프
            </span>
          </div>

          <div className="flex flex-col">
            {rows.map((row) => {
              const busy = subscribe.isPending && subscribe.variables === row.key;
              return (
                <button
                  key={row.key}
                  type="button"
                  disabled={row.pending || busy}
                  aria-disabled={row.pending}
                  onClick={() => {
                    if (row.pending) return;
                    // A subscribed brief opens; an unsubscribed one turns on
                    // first. One action per row, so there is no small second
                    // target to hit on the way to reading.
                    if (row.subscribed) {
                      setOpen(false);
                      navigate(`/brief/c/${row.key}`);
                    } else {
                      subscribe.mutate(row.key);
                    }
                  }}
                  className={cn(
                    'flex items-center gap-3 px-2.5 py-2 rounded-md select-none transition-colors duration-150',
                    'text-[14px] text-left',
                    row.pending
                      ? 'opacity-40 cursor-not-allowed text-sidebar-foreground/70'
                      : 'hover:bg-sidebar-accent',
                    row.subscribed ? 'text-sidebar-foreground' : 'text-sidebar-foreground/70',
                    busy && 'opacity-50 pointer-events-none'
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{row.label}</span>

                  {busy && (
                    <Loader2
                      className="h-3.5 w-3.5 shrink-0 animate-spin text-sidebar-foreground/50"
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
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500"
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
        </PopoverContent>
      </Popover>
    </div>
  );
}
