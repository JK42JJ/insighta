import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Flame, Pencil, Share2, Video, Zap, BarChart3 } from 'lucide-react';

import {
  useDashboard,
  ResumeCard,
  OrbitalMap,
  VideoShelf,
  SkillChips,
  BiasAlert,
  StatsGrid,
} from '@/features/mandala-dashboard';
import '@/features/mandala-dashboard/ui/mandala-dashboard.css';

export default function MandalaDashboardPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { dashboard, isLoading, error } = useDashboard(id);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-[720px] px-6 py-10">
        <div className="h-6 w-48 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-[420px] animate-pulse rounded-2xl bg-muted/50" />
      </div>
    );
  }

  if (error || !dashboard) {
    return (
      <div className="mx-auto max-w-[720px] px-6 py-10">
        <h1 className="text-lg font-bold">{t('dashboard.error.title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {error instanceof Error ? error.message : t('dashboard.error.notFound')}
        </p>
      </div>
    );
  }

  const { mandala, resume, cells, recommendations, skills, filteredVideos, stats } = dashboard;

  return (
    <div className="mx-auto max-w-[720px] px-6 py-10">
      {/* Resume card */}
      <ResumeCard resume={resume} />

      {/* Streak + actions row */}
      <div className="mb-10 flex items-center justify-between">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-yellow-500/10 bg-yellow-500/5 px-3.5 py-1 text-xs font-bold text-yellow-400">
          <Flame className="h-3.5 w-3.5" />
          {stats.streakDays}
          {t('dashboard.streak.suffix')}
        </span>
        <div className="flex gap-1.5">
          <Link
            to={`/mandalas/${mandala.id}/edit`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-transparent px-4 py-1.5 text-xs font-semibold text-muted-foreground transition-colors duration-150 hover:border-border/80 hover:text-foreground"
          >
            <Pencil className="h-3 w-3" />
            {t('dashboard.header.edit')}
          </Link>
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-transparent px-4 py-1.5 text-xs font-semibold text-muted-foreground transition-colors duration-150 hover:border-border/80 hover:text-foreground"
          >
            <Share2 className="h-3 w-3" />
            {t('dashboard.header.share')}
          </button>
        </div>
      </div>

      {/* Orbital map */}
      <OrbitalMap centerLabel={mandala.centerLabel} cells={cells} />

      {/* Recommended videos */}
      <SectionHeader
        icon={<Video className="h-4 w-4" />}
        title={t('dashboard.section.recommendations')}
      />
      <VideoShelf recommendations={recommendations} />

      {/* Skills */}
      <SectionHeader icon={<Zap className="h-4 w-4" />} title={t('dashboard.section.skills')} />
      <SkillChips mandalaId={mandala.id} skills={skills} />

      {/* Bias alert (hidden when no filtered videos) */}
      {filteredVideos.length > 0 && <BiasAlert filteredVideos={filteredVideos} />}

      {/* Stats */}
      <SectionHeader
        icon={<BarChart3 className="h-4 w-4" />}
        title={t('dashboard.section.stats')}
      />
      <StatsGrid stats={stats} />
    </div>
  );
}

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-2 text-sm font-bold text-muted-foreground">
      {icon}
      {title}
    </div>
  );
}
