/**
 * The brief's own panel: what the sidebar shows on every `/brief/*` route.
 *
 * Shaped like the note's panel on `/learning/:mandalaId/:videoId` -- the
 * subject at the top, then the chapters -- because a brief is read the way a
 * note is read. Here the subject is the category (with whether this reader
 * takes it) and the chapters are its issues, newest first, the one being
 * read marked. The issue's own table of contents nests under that row, so
 * nothing the previous panel offered is lost.
 *
 * The mandala list, the new-mandala button and the template finder do not
 * appear here: they belong to the app panel, and this panel replaces it
 * rather than sitting beside it. The mobile drawer renders this same
 * component, so the two never say different things.
 *
 * Reads the category route (`/brief/c/:key`) or, on an issue page, the
 * category the issue belongs to. On a category page there is no issue and the
 * contents are simply absent.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Check, Loader2, Newspaper } from 'lucide-react';

import { apiClient } from '@/shared/lib/api-client';
import type { IssueDocument } from '@/features/newsletter-note/lib/issue-types';
import { useBriefCategory } from '@/features/newsletter-note/model/useBriefCategory';
import { cn } from '@/shared/lib/utils';

import { SidebarBriefSection } from './SidebarBriefSection';

export interface SidebarBriefPanelProps {
  /** From `/brief/c/:categoryKey`, or the issue's category on `/brief/:slug`. */
  categoryKey: string | undefined;
  /** The issue being read, when one is. */
  currentSlug: string | undefined;
  /** The issue document, for the nested contents. Null on a category page. */
  issue: IssueDocument | null;
  issueLoading: boolean;
  collapsed: boolean;
  /** The contents entry the reader jumped to; owned by the caller (see SidebarBriefSection). */
  activeEntry: string | null;
  onSelectEntry: (label: string) => void;
  /** Called after navigating, so a drawer can close itself. */
  onNavigated?: () => void;
}

export function SidebarBriefPanel({
  categoryKey,
  currentSlug,
  issue,
  issueLoading,
  collapsed,
  activeEntry,
  onSelectEntry,
  onNavigated,
}: SidebarBriefPanelProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const category = useBriefCategory(categoryKey);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['brief-category', categoryKey] });
    void queryClient.invalidateQueries({ queryKey: ['brief-categories'] });
    void queryClient.invalidateQueries({ queryKey: ['brief-subscribed'] });
  };

  const subscribe = useMutation({
    mutationFn: async () => {
      if (!categoryKey) return;
      const res = await apiClient.subscribeToBrief(categoryKey, currentSlug);
      if (res.status !== 'ok') throw new Error(res.error ?? 'failed');
    },
    onSuccess: invalidate,
  });
  const unsubscribe = useMutation({
    mutationFn: async () => {
      if (!categoryKey) return;
      const res = await apiClient.unsubscribeFromBrief(categoryKey);
      if (res.status !== 'ok') throw new Error(res.error ?? 'failed');
    },
    onSuccess: invalidate,
  });

  // The collapsed rail has no room for a list. The note panel does the same.
  if (collapsed) return null;

  if (!categoryKey) {
    // An issue page before its document has loaded: the category is not known
    // yet, and a panel that names the wrong one is worse than a short wait.
    return <div className="px-3 py-2 text-[13px] text-sidebar-foreground/50">불러오는 중…</div>;
  }

  const data = category.data;
  const subscribed = data?.category.subscribed ?? false;
  const label = data?.category.label ?? '브리프';
  const issues = data?.issues ?? [];
  const busy = subscribe.isPending || unsubscribe.isPending;

  const open = (slug: string) => {
    navigate(`/brief/${slug}`);
    onNavigated?.();
  };

  return (
    <div className="px-1 flex flex-col" data-testid="brief-panel">
      <div className="px-2 py-2 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 truncate text-[14px] font-bold leading-snug text-sidebar-foreground">
            <Newspaper className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/60" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </h3>
          {data && (
            <p className="mt-0.5 truncate text-[12.5px] text-sidebar-foreground/50">
              {issues.length}호 발행
              {data.unread > 0 ? ` · 안 읽음 ${data.unread}` : ''}
            </p>
          )}
        </div>
        {/* One control, two states. Reads as a status while subscribed and
            turns into the exit on hover, the way the list page's button does.
            Not rendered until the state is known: a "구독" button that appears
            before the answer arrives is wrong for every subscriber. */}
        {data && (
          <button
            type="button"
            disabled={busy}
            onClick={() => (subscribed ? unsubscribe.mutate() : subscribe.mutate())}
            aria-pressed={subscribed}
            className={cn(
              'group inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[11.5px] transition-colors',
              subscribed
                ? 'border-sidebar-border/60 text-sidebar-foreground/60 hover:border-sidebar-border hover:text-sidebar-foreground'
                : 'border-sidebar-primary/40 text-sidebar-primary hover:bg-sidebar-primary/10',
              busy && 'opacity-50'
            )}
          >
            {busy ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            ) : subscribed ? (
              <Check className="h-3 w-3" aria-hidden="true" />
            ) : null}
            {subscribed ? (
              <>
                <span className="group-hover:hidden">구독 중</span>
                <span className="hidden group-hover:inline">구독 해제</span>
              </>
            ) : (
              <span>구독</span>
            )}
          </button>
        )}
      </div>

      <div className="border-t border-sidebar-border/50 pt-1.5">
        {category.isLoading && (
          <div className="px-3 py-2 text-[13px] text-sidebar-foreground/50">불러오는 중…</div>
        )}
        {category.isError && (
          <div className="px-3 py-2 text-[13px] text-sidebar-foreground/50">
            호 목록을 불러오지 못했습니다.
          </div>
        )}
        {data && issues.length === 0 && (
          <div className="px-3 py-2 text-[13px] text-sidebar-foreground/50">
            아직 발행된 호가 없습니다.
          </div>
        )}

        <ul role="list">
          {issues.map((it) => {
            const current = it.slug === currentSlug;
            return (
              <li key={it.slug} className="mb-0.5">
                <button
                  type="button"
                  onClick={() => open(it.slug)}
                  aria-current={current ? 'page' : undefined}
                  // Size and colour are both `text-*`; ordering inside each branch
                  // is what `twMerge` keeps. Same markup family as the contents.
                  className={cn(
                    'flex w-full items-start gap-2 pl-3.5 pr-2 py-1.5 text-left leading-[1.5] transition-colors',
                    current
                      ? 'border-l-2 border-sidebar-primary text-[14px] font-medium text-sidebar-primary'
                      : 'border-l border-sidebar-foreground/10 text-[13px] text-sidebar-foreground/60 hover:border-sidebar-foreground/50 hover:text-sidebar-foreground'
                  )}
                >
                  <span className="shrink-0 tabular-nums">{it.issueLabel}</span>
                  <span className="min-w-0 flex-1 truncate">{it.headline}</span>
                  {!it.read && (
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-sidebar-primary"
                      aria-label="안 읽음"
                    />
                  )}
                </button>

                {/* The issue's contents, under the issue being read. */}
                {current && (issue || issueLoading) && (
                  <div className="ml-3.5 border-l border-sidebar-foreground/10 pb-1">
                    <SidebarBriefSection
                      issue={issue}
                      loading={issueLoading}
                      collapsed={false}
                      active={activeEntry}
                      onSelect={onSelectEntry}
                      compact
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
