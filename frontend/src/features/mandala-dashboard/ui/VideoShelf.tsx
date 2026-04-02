import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Play } from 'lucide-react';

import type { DashboardRecommendation } from '@/shared/types/mandala-ux';

interface VideoShelfProps {
  recommendations: DashboardRecommendation[];
}

export function VideoShelf({ recommendations }: VideoShelfProps) {
  const { t } = useTranslation();

  // Empty state — CTA buttons
  if (recommendations.length === 0) {
    return (
      <div className="mb-10 flex h-20 items-center justify-center gap-3 rounded-[14px] border border-dashed border-border/60">
        <Link
          to="/"
          className="rounded-lg border border-border bg-transparent px-3.5 py-1.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:border-border/80 hover:text-foreground"
        >
          {t('dashboard.orbital.ctaAdd')} →
        </Link>
        <span
          className="cursor-default rounded-lg px-3.5 py-1.5 text-[11px] font-semibold text-primary"
          style={{ opacity: 0.4 }}
          title={t('dashboard.orbital.ctaAiSoon')}
        >
          {t('dashboard.orbital.ctaAi')} ✦
        </span>
      </div>
    );
  }

  return (
    <div className="mb-10 grid grid-cols-3 gap-3.5">
      {recommendations.map((rec) => (
        <div
          key={rec.videoId}
          className="cursor-pointer overflow-hidden rounded-[14px] border border-border bg-card transition-all duration-300 ease-out hover:-translate-y-[3px] hover:border-primary/20 hover:shadow-xl"
        >
          {/* Thumbnail */}
          <div
            className="relative grid w-full place-items-center"
            style={{
              aspectRatio: '16/9',
              background: 'linear-gradient(140deg, hsl(var(--muted)), hsl(var(--card)))',
            }}
          >
            <Play className="h-5 w-5 opacity-[0.12]" />
            <span className="absolute bottom-1.5 right-1.5 rounded bg-black/75 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400">
              {rec.duration}
            </span>
          </div>

          {/* Relevance score bar */}
          <div className="h-0.5 bg-muted">
            <div
              className="h-full rounded-r-sm"
              style={{
                width: `${rec.score}%`,
                background: 'linear-gradient(90deg, hsl(var(--primary)), #38d9a9)',
                transition: 'width 0.6s ease-out',
              }}
            />
          </div>

          {/* Body */}
          <div className="px-3.5 py-3 pb-3.5">
            <div className="mb-2 text-[13px] font-semibold leading-snug tracking-tight">
              {rec.title}
            </div>
            <div className="flex gap-1.5">
              <span className="rounded-[5px] bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                {rec.cellLabel}
              </span>
              <span className="rounded-[5px] bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-400">
                {rec.score}%
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
