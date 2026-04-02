import { useTranslation } from 'react-i18next';
import { Play } from 'lucide-react';

import type { DashboardResumeVideo } from '@/shared/types/mandala-ux';

interface ResumeCardProps {
  resume: DashboardResumeVideo | null;
}

export function ResumeCard({ resume }: ResumeCardProps) {
  const { t } = useTranslation();

  // No resume data — show inactive placeholder card
  if (!resume) {
    return (
      <div className="relative mb-3.5 flex items-center gap-4 overflow-hidden rounded-2xl border border-border/50 bg-card px-6 py-5 opacity-60">
        {/* Left gradient strip (muted) */}
        <div
          className="absolute bottom-0 left-0 top-0 w-[3px] rounded-l-2xl"
          style={{ background: 'hsl(var(--border))' }}
        />

        {/* Thumbnail placeholder */}
        <div className="relative flex-shrink-0">
          <div
            className="grid place-items-center rounded-lg"
            style={{
              width: 72,
              height: 48,
              background: 'hsl(var(--muted))',
            }}
          >
            <Play className="h-4 w-4 text-muted-foreground opacity-40" />
          </div>
        </div>

        {/* Body */}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[14px] font-bold tracking-tight text-muted-foreground">
            {t('dashboard.resume.empty.title')}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground/60">
            {t('dashboard.resume.empty.subtitle')}
          </div>
        </div>
      </div>
    );
  }

  const progressPct = (() => {
    const [wm, ws] = resume.watchedAt.split(':').map(Number);
    const [dm, ds] = resume.duration.split(':').map(Number);
    const watched = (wm ?? 0) * 60 + (ws ?? 0);
    const total = (dm ?? 0) * 60 + (ds ?? 0);
    return total > 0 ? (watched / total) * 100 : 0;
  })();

  const circumference = 2 * Math.PI * 7;
  const offset = circumference * (1 - progressPct / 100);

  return (
    <div className="relative mb-3.5 flex items-center gap-4 overflow-hidden rounded-2xl border border-border bg-card px-6 py-5">
      {/* Left gradient strip */}
      <div
        className="absolute bottom-0 left-0 top-0 w-[3px] rounded-l-2xl"
        style={{ background: 'linear-gradient(180deg, hsl(var(--primary)), #38d9a9)' }}
      />

      {/* Thumbnail + mini progress ring */}
      <div className="relative flex-shrink-0">
        <div
          className="grid place-items-center rounded-lg"
          style={{
            width: 72,
            height: 48,
            background: 'linear-gradient(135deg, hsl(var(--muted)), hsl(var(--card)))',
          }}
        >
          <Play className="h-4 w-4 opacity-25" />
        </div>
        <svg className="absolute -bottom-1 -right-1" width={20} height={20} viewBox="0 0 20 20">
          <circle
            cx={10}
            cy={10}
            r={7}
            fill="none"
            stroke="hsl(var(--border))"
            strokeWidth={2}
            opacity={0.2}
          />
          <circle
            cx={10}
            cy={10}
            r={7}
            fill="none"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            transform="rotate(-90 10 10)"
          />
        </svg>
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 text-[10.5px] font-bold uppercase tracking-wider text-primary">
          {resume.cellLabel}
        </div>
        <div className="truncate text-[15px] font-bold tracking-tight">{resume.videoTitle}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">
          {resume.watchedAt} / {resume.duration} | {t('dashboard.resume.relevance')}
          {resume.relevanceScore}%
        </div>
      </div>

      {/* CTA */}
      <button
        type="button"
        className="flex-shrink-0 rounded-xl bg-primary px-5 py-2 text-[13px] font-bold text-primary-foreground shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      >
        {t('dashboard.resume.playButton')}
      </button>
    </div>
  );
}
