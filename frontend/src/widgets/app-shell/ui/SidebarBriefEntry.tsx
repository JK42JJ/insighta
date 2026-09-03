/**
 * The briefs this reader takes, listed in the sidebar.
 *
 * Domains, not issues. The mandala list below shows mandalas and their cards
 * live one level in; the brief list shows briefs and their issues live one
 * level in. An earlier version listed issues here, which put "AI 엔지니어링
 * 제1호" on the same shelf as a whole mandala and left the ten domains
 * invisible — so adding a subscription meant leaving the sidebar to find a
 * screen that listed them.
 *
 * Only what the reader takes is listed. Adding one is a line at the foot,
 * the way a new mandala is a button at the top rather than eight greyed-out
 * suggestions in the list.
 *
 * The list comes from the subscriptions, not from the issues. Deriving it from
 * issues meant a brief the reader had just subscribed to was invisible until
 * its first issue published — the one moment they would go looking for it.
 */

import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Plus } from 'lucide-react';

import {
  apiClient,
  type SubscribedBriefIssue,
  type BriefCategoryRow,
} from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/utils';

interface SidebarBriefEntryProps {
  collapsed: boolean;
}

interface DomainRow {
  categoryKey: string;
  label: string;
  unread: number;
}

/**
 * The briefs this reader takes, with how many of each are unread.
 *
 * Subscriptions decide what is listed; issues only decide the count. A brief
 * with no issues yet is a row with no badge, which is the truth — as opposed
 * to no row, which reads as "the subscription did not take".
 */
function toDomains(categories: BriefCategoryRow[], issues: SubscribedBriefIssue[]): DomainRow[] {
  const unreadByKey = new Map<string, number>();
  for (const it of issues) {
    if (!it.read) unreadByKey.set(it.categoryKey, (unreadByKey.get(it.categoryKey) ?? 0) + 1);
  }
  return categories
    .filter((c) => c.subscribed)
    .map((c) => ({
      categoryKey: c.key,
      label: c.label,
      unread: unreadByKey.get(c.key) ?? 0,
    }));
}

export function SidebarBriefEntry({ collapsed }: SidebarBriefEntryProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(true);

  const { data } = useQuery({
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

  const domains = toDomains(categories ?? [], data?.issues ?? []);
  const unreadTotal = data?.unread ?? 0;

  // The collapsed rail has no room for a list. The mandala section does the
  // same rather than rendering a column of truncated names.
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
            is the only state where the per-row dots are invisible. */}
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
        <div className="mt-0.5 max-h-[28vh] overflow-y-auto scrollbar-sidebar">
          {domains.map((d) => {
            const href = `/brief/c/${d.categoryKey}`;
            const active = location.pathname === href;
            return (
              <div
                key={d.categoryKey}
                role="button"
                tabIndex={0}
                onClick={() => navigate(href)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    navigate(href);
                  }
                }}
                className={cn(
                  'flex items-center gap-2 px-2.5 py-1.5 rounded-lg cursor-pointer',
                  'text-[13px] transition-colors duration-150',
                  active
                    ? 'bg-sidebar-accent text-sidebar-foreground'
                    : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground'
                )}
              >
                <span className="min-w-0 flex-1 truncate">{d.label}</span>
                {d.unread > 0 && (
                  <span className="shrink-0 rounded-full bg-sidebar-primary px-1.5 text-[10px] font-bold leading-[16px] text-sidebar-primary-foreground">
                    {d.unread}
                  </span>
                )}
              </div>
            );
          })}

          {domains.length === 0 && (
            <p className="px-2.5 py-1.5 text-[12px] leading-relaxed text-sidebar-foreground/50">
              구독한 브리프가 없습니다.
            </p>
          )}

          <button
            type="button"
            onClick={() => navigate('/brief')}
            className="mt-0.5 w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[12.5px] text-sidebar-foreground/55 hover:bg-sidebar-accent/60 hover:text-sidebar-foreground transition-colors duration-150"
          >
            <Plus className="h-3 w-3 shrink-0" />
            브리프 추가
          </button>
        </div>
      )}
    </div>
  );
}
