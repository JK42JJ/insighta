import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { apiClient } from '@/shared/lib/api-client';
import { useAuth } from '@/features/auth/model/useAuth';
import { LandingHeader } from '@/pages/landing/ui/components/LandingHeader';
import { GradientBackground } from '@/pages/landing/ui/components/GradientBackground';
import { FooterSection } from '@/pages/landing/ui/components/FooterSection';
import { useExploreMandalas, useExploreClone } from '@/features/explore';
import { useExploreFilters } from '@/features/explore';
import { ExploreHero } from '@/features/explore/ui/ExploreHero';
import { ExploreSearchBar } from '@/features/explore/ui/ExploreSearchBar';
import { DomainChips } from '@/features/explore/ui/DomainChips';
import { ExploreToolbar } from '@/features/explore/ui/ExploreToolbar';
import { ExploreCard } from '@/features/explore/ui/ExploreCard';
import { ExploreExpandModal } from '@/features/explore/ui/ExploreExpandModal';
import { PublicMandalaView } from './PublicMandalaView';
import type { ExploreMandala } from '@/shared/types/explore';
import type { MandalaDomain } from '@/shared/config/domain-colors';

interface ModalState {
  isOpen: boolean;
  mandala: ExploreMandala | null;
  rootLevel: { centerGoal: string; subjects: string[] };
  subLevels: ({ centerGoal: string; subjects: string[] } | null)[];
  centerLabel?: string;
  subLabels?: string[];
}

const EMPTY_MODAL: ModalState = {
  isOpen: false,
  mandala: null,
  rootLevel: { centerGoal: '', subjects: [] },
  subLevels: [],
};

export default function ExplorePage() {
  const { slug } = useParams<{ slug: string }>();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isLoggedIn } = useAuth();
  const { filters, updateFilters } = useExploreFilters();
  const { data, isLoading } = useExploreMandalas(filters);
  const cloneMutation = useExploreClone();

  const [modal, setModal] = useState<ModalState>(EMPTY_MODAL);

  const handleCardClick = useCallback(async (mandala: ExploreMandala) => {
    // Open modal with summary data first
    setModal({
      isOpen: true,
      mandala,
      rootLevel: mandala.rootLevel ?? { centerGoal: mandala.title, subjects: [] },
      subLevels: [],
      centerLabel: mandala.rootLevel?.centerLabel ?? undefined,
      subLabels: mandala.rootLevel?.subjectLabels,
    });

    // Fetch full level data for 9×9 grid
    if (mandala.shareSlug) {
      try {
        const result = await apiClient.getPublicMandala(mandala.shareSlug);
        const levels = result.mandala.levels ?? [];
        const root = levels.find((l) => l.depth === 0);
        const subs = levels
          .filter((l) => l.depth === 1)
          .sort((a, b) => a.position - b.position)
          .map((l) => ({ centerGoal: l.centerGoal, subjects: l.subjects }));

        setModal((prev) => ({
          ...prev,
          rootLevel: root
            ? { centerGoal: root.centerGoal, subjects: root.subjects }
            : prev.rootLevel,
          subLevels: subs,
          centerLabel: root?.centerLabel ?? prev.centerLabel,
          subLabels: (root?.subjectLabels?.length ?? 0) > 0 ? root!.subjectLabels : prev.subLabels,
        }));
      } catch {
        // keep modal open with summary data
      }
    }
  }, []);

  const handleCloseModal = useCallback(() => setModal(EMPTY_MODAL), []);

  const handleClone = useCallback(() => {
    if (!modal.mandala) return;
    if (!isLoggedIn) {
      navigate('/login?returnTo=/explore');
      return;
    }
    cloneMutation.mutate(modal.mandala.id, {
      onSuccess: (res) => navigate(`/mandalas/${res.data.mandalaId}/edit`),
    });
  }, [modal.mandala, isLoggedIn, navigate, cloneMutation]);

  const handleCopyLink = useCallback(async () => {
    if (!modal.mandala) return;
    const url = `${window.location.origin}/explore/${modal.mandala.shareSlug ?? modal.mandala.id}`;
    await navigator.clipboard.writeText(url);
  }, [modal.mandala]);

  // Slug-based detail view
  if (slug) return <PublicMandalaView slug={slug} />;

  const mandalas = data?.mandalas ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / (data?.limit ?? 24));

  return (
    <div className="relative min-h-screen bg-background">
      <GradientBackground variant="F" />
      <div className="relative z-10">
        {!isLoggedIn && <LandingHeader />}

        <main className="max-w-[1120px] mx-auto px-7 pt-12 pb-24">
          <ExploreHero />
          <ExploreSearchBar value={filters.q} onChange={(q) => updateFilters({ q })} />
          <DomainChips selected={filters.domain} onSelect={(domain) => updateFilters({ domain })} />
          <ExploreToolbar
            total={total}
            source={filters.source}
            sort={filters.sort}
            onSourceChange={(source) => updateFilters({ source })}
            onSortChange={(sort) => updateFilters({ sort })}
          />

          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          ) : mandalas.length === 0 ? (
            <div className="text-center py-20">
              <Globe className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
              <h2 className="text-lg font-semibold text-foreground mb-2">{t('explore.empty')}</h2>
              <p className="text-sm text-muted-foreground">{t('explore.emptyDesc')}</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(330px,1fr))] gap-3.5">
                {mandalas.map((m) => (
                  <ExploreCard
                    key={m.id}
                    id={m.id}
                    title={m.title}
                    centerGoal={m.rootLevel?.centerGoal ?? m.title}
                    centerLabel={m.rootLevel?.centerLabel ?? undefined}
                    subjects={m.rootLevel?.subjects ?? []}
                    subjectLabels={m.rootLevel?.subjectLabels}
                    domain={m.domain as MandalaDomain | null}
                    isTemplate={m.isTemplate}
                    author={m.author}
                    likeCount={m.likeCount}
                    cloneCount={m.cloneCount}
                    updatedAt={new Date(m.updatedAt).toLocaleDateString()}
                    onClick={() => handleCardClick(m)}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex justify-center gap-2 mt-8">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateFilters({ page: Math.max(1, filters.page - 1) })}
                    disabled={filters.page === 1}
                  >
                    {t('common.previous')}
                  </Button>
                  <span className="flex items-center px-3 text-sm text-muted-foreground">
                    {filters.page} / {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => updateFilters({ page: Math.min(totalPages, filters.page + 1) })}
                    disabled={filters.page === totalPages}
                  >
                    {t('common.next')}
                  </Button>
                </div>
              )}
            </>
          )}
        </main>
      </div>

      {modal.mandala && (
        <ExploreExpandModal
          isOpen={modal.isOpen}
          onClose={handleCloseModal}
          title={modal.mandala.title}
          domain={modal.mandala.domain as MandalaDomain | null}
          isTemplate={modal.mandala.isTemplate}
          author={modal.mandala.author}
          rootLevel={modal.rootLevel}
          subLevels={modal.subLevels}
          centerLabel={modal.centerLabel}
          subLabels={modal.subLabels}
          likeCount={modal.mandala.likeCount}
          cloneCount={modal.mandala.cloneCount}
          updatedAt={new Date(modal.mandala.updatedAt).toLocaleDateString()}
          onClone={handleClone}
          onCopyLink={handleCopyLink}
        />
      )}
      <FooterSection />
    </div>
  );
}
