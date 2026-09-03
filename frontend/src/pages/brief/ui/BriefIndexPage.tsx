/**
 * The reader's briefs, and the ones they could take.
 *
 * Two lists on one page. Issues first, because someone arriving here usually
 * wants this week's, not a catalogue. Subscriptions second, because deciding
 * what to take is a rarer act than reading what you already took.
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Newspaper, Check } from 'lucide-react';

import { apiClient } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/utils';

export function BriefIndexPage(): JSX.Element {
  const navigate = useNavigate();
  const qc = useQueryClient();

  const issues = useQuery({
    queryKey: ['brief-subscribed'],
    queryFn: async () => {
      const res = await apiClient.getSubscribedBriefs();
      if (res.status !== 'ok' || !res.data) throw new Error(res.error ?? 'failed');
      return res.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const categories = useQuery({
    queryKey: ['brief-categories'],
    queryFn: async () => {
      const res = await apiClient.getBriefCategories();
      if (res.status !== 'ok' || !res.data) throw new Error(res.error ?? 'failed');
      return res.data.categories;
    },
    staleTime: 5 * 60 * 1000,
  });

  const toggle = useMutation({
    mutationFn: async ({ key, on }: { key: string; on: boolean }) => {
      const res = on
        ? await apiClient.subscribeToBrief(key)
        : await apiClient.unsubscribeFromBrief(key);
      if (res.status !== 'ok') throw new Error(res.error ?? 'failed');
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['brief-categories'] });
      void qc.invalidateQueries({ queryKey: ['brief-subscribed'] });
    },
  });

  useEffect(() => {
    document.title = '주간 브리프 · Insighta';
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[720px] px-6 py-10">
        <h1 className="flex items-center gap-2.5 text-[22px] font-bold tracking-tight">
          <Newspaper className="h-5 w-5" />
          주간 브리프
        </h1>

        <section className="mt-8">
          {issues.isLoading && <p className="text-[13px] text-muted-foreground">불러오는 중…</p>}

          {!issues.isLoading && (issues.data?.issues.length ?? 0) === 0 && (
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              아직 받은 호가 없습니다. 아래에서 브리프를 구독하면 발행되는 대로 여기에 쌓입니다.
            </p>
          )}

          <ul className="space-y-2">
            {issues.data?.issues.map((it) => (
              <li key={it.slug}>
                <button
                  type="button"
                  onClick={() => navigate(`/brief/${it.slug}`)}
                  className={cn(
                    'w-full rounded-xl border border-border/60 px-4 py-3.5 text-left',
                    'transition-colors hover:border-border hover:bg-accent/40'
                  )}
                >
                  <div className="flex items-baseline gap-2 text-[11.5px] text-muted-foreground">
                    <span>{it.categoryLabel}</span>
                    <span>·</span>
                    <span>{it.issueLabel}</span>
                    <span>·</span>
                    <span>{it.dateLabel}</span>
                    {!it.read && (
                      // The dot, not a word. An unread marker that needs
                      // reading is one more thing to read.
                      <span
                        className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary"
                        aria-label="안 읽음"
                      />
                    )}
                  </div>
                  <div
                    className={cn(
                      'mt-1.5 text-[15px] leading-snug',
                      it.read ? 'text-foreground/70' : 'font-semibold text-foreground'
                    )}
                  >
                    {it.headline}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-12">
          <h2 className="text-[12px] font-semibold uppercase tracking-widest text-muted-foreground">
            구독
          </h2>
          <ul className="mt-3 space-y-1.5">
            {categories.data?.map((c) => (
              <li
                key={c.key}
                className="flex items-start gap-3 rounded-lg px-3 py-2.5 hover:bg-accent/30"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[14px] font-medium">{c.label}</span>
                    {/* A brief with no issues yet is listed rather than hidden:
                        the list is also the roadmap, and hiding what is coming
                        makes the product look smaller than it is. */}
                    <span className="text-[11px] text-muted-foreground">
                      {c.issues > 0 ? `${c.issues}호` : '준비 중'}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">
                    {c.blurb}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={toggle.isPending}
                  onClick={() => toggle.mutate({ key: c.key, on: !c.subscribed })}
                  className={cn(
                    'shrink-0 rounded-lg border px-2.5 py-1 text-[12px] font-medium transition-colors',
                    c.subscribed
                      ? 'border-border bg-accent/60 text-foreground'
                      : 'border-border/60 text-muted-foreground hover:text-foreground',
                    toggle.isPending && 'opacity-50'
                  )}
                >
                  {c.subscribed ? (
                    <span className="flex items-center gap-1">
                      <Check className="h-3 w-3" />
                      구독 중
                    </span>
                  ) : (
                    '구독'
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export default BriefIndexPage;
