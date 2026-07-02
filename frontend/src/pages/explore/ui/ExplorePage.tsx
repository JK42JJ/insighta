import { useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, ArrowLeft, Globe } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/shared/ui/button';
import { apiClient } from '@/shared/lib/api-client';
import { useAuth } from '@/features/auth/model/useAuth';
import { useExploreMandalas, useExploreCreateFromTemplate } from '@/features/explore';
import { useExploreFilters } from '@/features/explore';
import { useDeleteMandala } from '@/features/mandala';
import { useMandalaStore } from '@/stores/mandalaStore';
import { queryKeys } from '@/shared/config/query-client';
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
  const { isLoggedIn, user } = useAuth();
  const currentUserId = user?.id ?? null;
  const { filters, updateFilters } = useExploreFilters();
  const { data, isLoading } = useExploreMandalas(filters);
  const createFromTemplateMutation = useExploreCreateFromTemplate();
  const selectMandala = useMandalaStore((s) => s.selectMandala);
  const setPendingMandala = useMandalaStore((s) => s.setPendingMandala);
  const clearPendingMandala = useMandalaStore((s) => s.clearPendingMandala);
  const setJustCreated = useMandalaStore((s) => s.setJustCreated);

  const [modal, setModal] = useState<ModalState>(EMPTY_MODAL);
  // Sync rapid-click guard. React's mutation.isPending is async — first onClick
  // fires the mutation but disabled={isPending} only propagates on next render,
  // so a 50–100ms double/triple-click can fire create-from-template 2-4 times.
  // Ref check is synchronous and beats the render race. Reset in onSettled.
  const isStartingRef = useRef(false);
  // Optimistic local mask for delete (CP451 사이드바 패턴 — cache propagation
  // race 회피, parent-host mutation, fail rollback). Hidden 즉시, BE 성공 시
  // 유지 + cache invalidate, 실패 시 mask 해제.
  const [deletingIds, setDeletingIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const deleteMandala = useDeleteMandala();

  const handleCardClick = useCallback(
    async (mandala: ExploreMandala) => {
      // Owner branching: 내 만다라 = 모달 skip → selectMandala + dashboard 진입.
      // 타인 카드 = 기존 modal 미리보기 (CTA 안에서 create-from-template).
      const isMine = !!currentUserId && mandala.userId === currentUserId;
      if (isMine) {
        selectMandala(mandala.id);
        navigate('/');
        return;
      }
      setModal({
        isOpen: true,
        mandala,
        rootLevel: mandala.rootLevel ?? { centerGoal: mandala.title, subjects: [] },
        subLevels: [],
        centerLabel: mandala.rootLevel?.centerLabel ?? undefined,
        subLabels: mandala.rootLevel?.subjectLabels,
      });

      if (mandala.shareSlug) {
        try {
          const result = await apiClient.getPublicMandala(mandala.shareSlug);
          const levels = result.mandala.levels ?? [];
          const root = levels.find((l) => l.depth === 0);
          const subs = levels
            .filter((l) => l.depth === 1)
            .sort((a, b) => a.position - b.position)
            .map((l) => ({
              centerGoal: l.centerGoal,
              subjects: l.subjects,
              subjectLabels: l.subjectLabels,
            }));

          setModal((prev) => ({
            ...prev,
            rootLevel: root
              ? { centerGoal: root.centerGoal, subjects: root.subjects }
              : prev.rootLevel,
            subLevels: subs,
            centerLabel: root?.centerLabel ?? prev.centerLabel,
            subLabels:
              (root?.subjectLabels?.length ?? 0) > 0 ? root!.subjectLabels : prev.subLabels,
          }));
        } catch {
          // keep modal open with summary data
        }
      }
    },
    [currentUserId, selectMandala, navigate]
  );

  const handleCloseModal = useCallback(() => setModal(EMPTY_MODAL), []);

  const handleStart = useCallback(() => {
    if (!modal.mandala) return;
    if (!isLoggedIn) {
      navigate('/login?returnTo=/explore');
      return;
    }
    if (isStartingRef.current) return;
    if (useMandalaStore.getState().pendingMandala != null) return;
    isStartingRef.current = true;

    const tempId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    // Optimistic: set pending state + select tempId + instant nav so dashboard
    // renders the skeleton/progress bar while the server creates the mandala.
    // Mirrors useWizard.fireCreateMandala / fireCreateMandalaFromTemplate.
    setPendingMandala({
      tempId,
      startedAt: Date.now(),
      originalInputs: {
        title: modal.mandala.title,
        centerGoal: modal.mandala.centerGoal ?? modal.mandala.title,
        subjects: modal.mandala.subjects ?? [],
      },
    });
    selectMandala(tempId);
    // CardDiscoveryProgress (= "Reading your goals" skeleton) 트리거.
    // IndexPage:243 isNewMandalaActive = justCreatedMandalaId === effectiveMandalaId.
    setJustCreated(tempId);
    navigate('/');

    createFromTemplateMutation.mutate(modal.mandala.id, {
      onSuccess: (res) => {
        // Cache swap: tempId → real id in the mandala list.
        queryClient.setQueryData(
          queryKeys.mandala.list(),
          (
            old:
              | { mandalas: Array<{ id: string } & Record<string, unknown>>; total: number }
              | undefined
          ) => {
            if (!old) return old;
            return {
              ...old,
              mandalas: old.mandalas.map((m) =>
                m.id === tempId ? { ...m, id: res.mandalaId } : m
              ),
            };
          }
        );
        // Reconcile selected pointer + justCreated marker so isNewMandalaActive
        // remains true on the real id (skeleton stays until cards arrive).
        const storeState = useMandalaStore.getState();
        if (storeState.selectedMandalaId === tempId) {
          storeState.selectMandala(res.mandalaId);
        }
        if (storeState.justCreatedMandalaId === tempId) {
          setJustCreated(res.mandalaId);
        }
        clearPendingMandala();
      },
      onError: () => {
        // Rollback optimistic state; toast surfaces the error to the user.
        clearPendingMandala();
        setJustCreated(null);
        toast.error(t('explore.modal.startError', '템플릿 시작에 실패했습니다.'));
      },
      onSettled: () => {
        isStartingRef.current = false;
      },
    });
  }, [
    modal.mandala,
    isLoggedIn,
    navigate,
    createFromTemplateMutation,
    selectMandala,
    setPendingMandala,
    clearPendingMandala,
    setJustCreated,
    queryClient,
    t,
  ]);

  const handleCopyLink = useCallback(async () => {
    if (!modal.mandala) return;
    const url = `${window.location.origin}/explore/${modal.mandala.shareSlug ?? modal.mandala.id}`;
    await navigator.clipboard.writeText(url);
  }, [modal.mandala]);

  const handleBack = useCallback(() => {
    navigate('/');
  }, [navigate]);

  // 인라인 [편집] = MandalaEditorPage 라우트 (router/index.tsx:71, 살아있음, 핸드오프 §4 옵션 B).
  const handleEdit = useCallback(
    (mandalaId: string) => {
      navigate(`/mandalas/${mandalaId}/edit`);
    },
    [navigate]
  );

  // 인라인 [삭제] — confirm → DELETE /api/v1/mandalas/:id → optimistic local
  // mask + cache invalidate + toast. 실패 시 mask rollback + error toast.
  // CP451 사이드바 패턴 (parent-host mutation host) 동일 적용.
  const handleDelete = useCallback(
    (mandalaId: string) => {
      const ok = window.confirm(t('explore.card.deleteConfirm'));
      if (!ok) return;
      setDeletingIds((prev) => {
        const next = new Set(prev);
        next.add(mandalaId);
        return next;
      });
      deleteMandala.mutate(mandalaId, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.explore.all });
          queryClient.invalidateQueries({ queryKey: queryKeys.mandala.all });
          toast.success(t('explore.card.deleteSuccess'));
        },
        onError: () => {
          setDeletingIds((prev) => {
            const next = new Set(prev);
            next.delete(mandalaId);
            return next;
          });
          toast.error(t('explore.card.deleteError'));
        },
      });
    },
    [t, deleteMandala, queryClient]
  );

  if (slug) return <PublicMandalaView slug={slug} />;

  const mandalas = data?.mandalas ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / (data?.limit ?? 24));

  return (
    <div
      className="relative min-h-screen overflow-x-hidden"
      style={{ background: 'hsl(var(--background))' }}
    >
      {/* Subtle radial gradient (top center, wizard-style ambience) */}
      <div
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            'radial-gradient(ellipse 60% 50% at 50% 0%, hsl(var(--primary) / 0.05), transparent 60%)',
        }}
      />

      {/* Wizard-style top toolbar (single back button only) */}
      <div className="relative z-10 px-6 py-4">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12.5px] font-medium transition"
          style={{
            background: 'transparent',
            border: '1px solid hsl(var(--border) / 0.5)',
            color: 'hsl(var(--muted-foreground))',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'hsl(var(--foreground))';
            e.currentTarget.style.borderColor = 'hsl(var(--border))';
            e.currentTarget.style.background = 'hsl(var(--accent) / 0.3)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'hsl(var(--muted-foreground))';
            e.currentTarget.style.borderColor = 'hsl(var(--border) / 0.5)';
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          {t('explore.backButton')}
        </button>
      </div>

      <main className="relative z-10 max-w-[1120px] mx-auto px-8 pb-20">
        {/* Headline (mockup v6: 36px / weight 700 / letter-spacing -0.03em / center) */}
        <div className="text-center pt-12 pb-9">
          <h1
            className="text-[36px] font-bold leading-[1.2]"
            style={{
              color: 'hsl(var(--foreground))',
              letterSpacing: '-0.03em',
            }}
          >
            {t('explore.headline')}
          </h1>
        </div>

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
            {/* Explicit 3-col responsive grid (mockup v6: 3 / 2 / 1 at 900 / 600 breakpoints) */}
            <div className="grid grid-cols-3 max-[900px]:grid-cols-2 max-[600px]:grid-cols-1 gap-4">
              {mandalas
                .filter((m) => !deletingIds.has(m.id))
                .map((m) => {
                  const isMine = !!currentUserId && m.userId === currentUserId;
                  return (
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
                      cloneCount={m.cloneCount}
                      isMine={isMine}
                      onClick={() => handleCardClick(m)}
                      onEdit={isMine ? () => handleEdit(m.id) : undefined}
                      onDelete={isMine ? () => handleDelete(m.id) : undefined}
                    />
                  );
                })}
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
          cloneCount={modal.mandala.cloneCount}
          updatedAt={new Date(modal.mandala.updatedAt).toLocaleDateString()}
          onStart={handleStart}
          isStarting={createFromTemplateMutation.isPending}
          onCopyLink={handleCopyLink}
        />
      )}
    </div>
  );
}
