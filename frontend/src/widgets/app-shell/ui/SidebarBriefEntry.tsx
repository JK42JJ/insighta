/**
 * The way into the weekly brief, from the mandala panel.
 *
 * It sits directly above the mandala list rather than in the top block. That
 * block is where things are made — new mandala, find a template, search — and
 * a brief is read, not made. Below it, level with the mandala list, both read
 * as "what I have".
 *
 * The badge counts unread issues and disappears at zero. A weekly publication
 * that always wears a number is a number nobody looks at.
 */

import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Newspaper } from 'lucide-react';

import { apiClient } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/utils';

interface SidebarBriefEntryProps {
  collapsed: boolean;
}

export function SidebarBriefEntry({ collapsed }: SidebarBriefEntryProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const active = location.pathname.startsWith('/brief');

  const { data } = useQuery({
    queryKey: ['brief-subscribed'],
    queryFn: async () => {
      const res = await apiClient.getSubscribedBriefs();
      if (res.status !== 'ok' || !res.data) throw new Error(res.error ?? 'failed');
      return res.data;
    },
    // A weekly publication does not change between renders. Refetching on
    // every window focus would spend a request to learn the same number.
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const unread = data?.unread ?? 0;
  const total = data?.issues.length ?? 0;

  // Nothing to enter yet. An entry point to an empty room is worse than no
  // entry point: the reader clicks, finds nothing, and does not click again.
  if (total === 0) return null;

  return (
    <div className={cn('shrink-0', collapsed ? 'px-1 pb-2' : 'px-2 pb-2')}>
      <button
        type="button"
        onClick={() => navigate('/brief')}
        aria-label="주간 브리프"
        aria-current={active ? 'page' : undefined}
        className={cn(
          'w-full flex items-center gap-2.5 rounded-lg border border-transparent',
          'text-[13.5px] font-medium transition-colors',
          collapsed ? 'justify-center px-0 py-2' : 'px-3 py-2',
          active
            ? 'bg-sidebar-accent text-sidebar-foreground border-sidebar-border'
            : 'text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/60'
        )}
      >
        <Newspaper className="w-4 h-4 shrink-0" />
        {!collapsed && <span className="flex-1 text-left">주간 브리프</span>}
        {unread > 0 && (
          <span
            className={cn(
              'shrink-0 rounded-full bg-sidebar-primary px-1.5 text-[10px] font-bold',
              'leading-[17px] text-sidebar-primary-foreground',
              collapsed && 'absolute translate-x-3 -translate-y-2'
            )}
          >
            {unread}
          </span>
        )}
      </button>
    </div>
  );
}
