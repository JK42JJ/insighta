import { useTranslation } from 'react-i18next';
import { Play, Video } from 'lucide-react';

import type { DashboardRecommendation } from '@/shared/types/mandala-ux';

interface VideoShelfProps {
  recommendations: DashboardRecommendation[];
}

export function VideoShelf({ recommendations }: VideoShelfProps) {
  const { t } = useTranslation();

  // Empty state — placeholder cards
  if (recommendations.length === 0) {
    return (
      <div className="mb-10 grid grid-cols-3 gap-3.5 opacity-60">
        {Array.from({ length: 3 }, (_, i) => (
          <div
            key={i}
            className="overflow-hidden rounded-[14px] border border-dashed border-border/60 bg-card"
          >
            <div
              className="grid w-full place-items-center"
              style={{ aspectRatio: '16/9', background: 'hsl(var(--muted) / 0.3)' }}
            >
              {i === 1 ? (
                <Video className="h-5 w-5 text-muted-foreground opacity-30" />
              ) : (
                <div className="h-5 w-5" />
              )}
            </div>
            <div className="px-3.5 py-3 pb-3.5">
              {i === 1 ? (
                <p className="text-center text-[11px] font-semibold text-muted-foreground/60">
                  {t('dashboard.videoShelf.empty.line1')}
                  <br />
                  {t('dashboard.videoShelf.empty.line2')}
                </p>
              ) : (
                <div className="space-y-1.5">
                  <div className="h-3 w-3/4 rounded bg-muted/30" />
                  <div className="h-3 w-1/2 rounded bg-muted/30" />
                </div>
              )}
            </div>
          </div>
        ))}
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
