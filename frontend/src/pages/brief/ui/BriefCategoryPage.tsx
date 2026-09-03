/**
 * One brief's issues, as a grid of cards.
 *
 * The path a reader already knows: 만다라 → 주제 → 카드 목록. A brief is a
 * subject too, so 브리프 → 도메인 → 카드 목록 is the same path, and the card is
 * the same card — `InsightCardItemV2`, not a second card shape that would drift
 * from the first the week either changed.
 *
 * Three things differ from a mandala grid, each because of what an issue is:
 *
 *   not draggable   an issue belongs to no cell, so there is nowhere to drop it
 *   newest first    a weekly is read forward; the API already orders it so
 *   unread dot      the one piece of state a mandala card does not have
 *
 * The grid is written here rather than reusing `CardList`, which carries the
 * drag-and-drop machinery this surface has no use for and is under a change
 * guard. Sharing it would mean either dragging that in or cutting it up.
 */

import { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Newspaper } from 'lucide-react';

import { apiClient } from '@/shared/lib/api-client';
import { InsightCardItemV2 } from '@/widgets/card-list/ui/InsightCardItemV2';
import { briefIssueToInsightCard } from '@/entities/card/lib/brief-card';
import { keepKind, acceptsBriefOnly } from '@/entities/card/lib/card-kind';
import { cn } from '@/shared/lib/utils';

/** Matches the mandala grid's gap and padding so the two read as one surface. */
const BRIEF_GRID_CLASS =
  'grid gap-3 grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 pb-20';

export function BriefCategoryPage(): JSX.Element {
  const { categoryKey } = useParams<{ categoryKey: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const subscribed = useQuery({
    queryKey: ['brief-subscribed'],
    queryFn: async () => {
      const res = await apiClient.getSubscribedBriefs();
      if (res.status !== 'ok' || !res.data) throw new Error(res.error ?? 'failed');
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  // For the title. An issue row carries its own category label, but a brief
  // with nothing published yet has no issue row to carry one — and that is
  // precisely the case where the reader most needs to be told where they are.
  const categories = useQuery({
    queryKey: ['brief-categories'],
    queryFn: async () => {
      const res = await apiClient.getBriefCategories();
      if (res.status !== 'ok' || !res.data) throw new Error(res.error ?? 'failed');
      return res.data.categories;
    },
    staleTime: 5 * 60 * 1000,
  });

  const issues = useMemo(
    () => (subscribed.data?.issues ?? []).filter((i) => i.categoryKey === categoryKey),
    [subscribed.data, categoryKey]
  );

  // The guard runs on what is about to be rendered, not on what came back —
  // a card that survives conversion and then turns out to be the wrong kind
  // is exactly the case worth hearing about.
  const cards = useMemo(
    () => keepKind(issues.map(briefIssueToInsightCard), acceptsBriefOnly, '브리프 그리드'),
    [issues]
  );

  const category = categories.data?.find((c) => c.key === categoryKey);
  const label = category?.label ?? issues[0]?.categoryLabel ?? '브리프';

  // Turning a brief off lives here rather than in the sidebar. The sidebar row
  // has one action — open it — and a second, smaller target inside it would be
  // a control you can hit by accident on the way to reading. This is the page
  // of the thing being switched off, which is where that decision is made.
  const unsubscribe = useMutation({
    mutationFn: async () => {
      if (!categoryKey) return;
      const res = await apiClient.unsubscribeFromBrief(categoryKey);
      if (res.status !== 'ok') throw new Error(res.error ?? 'failed');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['brief-categories'] });
      void queryClient.invalidateQueries({ queryKey: ['brief-subscribed'] });
      navigate('/');
    },
  });

  useEffect(() => {
    document.title = `${label} · 브리프 · Insighta`;
  }, [label]);

  const loading = subscribed.isLoading || categories.isLoading;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1400px] px-5 py-7">
        <header className="mb-6 flex items-center gap-2.5">
          <h1 className="flex items-center gap-2 text-[19px] font-bold tracking-tight">
            <Newspaper className="h-[18px] w-[18px]" aria-hidden="true" />
            {label}
          </h1>
          {!loading && issues.length > 0 && (
            <span className="text-[12.5px] text-muted-foreground">{issues.length}호</span>
          )}
          {category?.subscribed && (
            <button
              type="button"
              disabled={unsubscribe.isPending}
              onClick={() => unsubscribe.mutate()}
              className={cn(
                'group ml-auto inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1',
                'border-border/60 text-[12px] text-muted-foreground transition-colors',
                'hover:border-border hover:text-foreground',
                unsubscribe.isPending && 'opacity-50'
              )}
            >
              <Check className="h-3 w-3" aria-hidden="true" />
              <span className="group-hover:hidden">구독 중</span>
              <span className="hidden group-hover:inline">구독 해제</span>
            </button>
          )}
        </header>

        {loading && <p className="text-[13px] text-muted-foreground">불러오는 중…</p>}

        {!loading && issues.length === 0 && (
          <div className="rounded-xl border border-border/60 px-5 py-8">
            <p className="text-[13.5px] leading-relaxed text-muted-foreground">
              {category?.subscribed
                ? '구독 중입니다. 첫 호가 발행되면 여기에 카드로 쌓입니다.'
                : '아직 이 브리프를 구독하지 않았습니다. 좌측 목록에서 켜면 여기에 쌓입니다.'}
            </p>
          </div>
        )}

        {cards.length > 0 && (
          <div className={BRIEF_GRID_CLASS}>
            {cards.map((card, i) => {
              const issue = issues[i];
              return (
                <div key={card.id} className="relative">
                  {/* The dot, not a word — the same marker the sidebar and the
                      index use, so unread means one thing across the product. */}
                  {!issue.read && (
                    <span
                      className="absolute -top-1 -left-1 z-20 h-2.5 w-2.5 rounded-full bg-sidebar-primary ring-2 ring-background"
                      aria-label="안 읽음"
                    />
                  )}
                  <InsightCardItemV2
                    card={card}
                    isDraggable={false}
                    onCardClick={() => navigate(`/brief/${issue.slug}`)}
                    sectorLabel={issue.issueLabel}
                    className={cn(issue.read && 'opacity-[0.72] hover:opacity-100')}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default BriefCategoryPage;
