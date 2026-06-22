import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient, ApiHttpError, type MandalaResponse } from '@/shared/lib/api-client';
import { queryKeys } from '@/shared/config/query-client';
import { useAuth } from '@/features/auth/model/useAuth';
import type { MandalaLevel } from '@/entities/card/model/types';

/** Fallback empty root level — used when no mandala exists in DB */
const EMPTY_ROOT_LEVELS: Record<string, MandalaLevel> = {
  root: {
    id: 'root',
    centerGoal: '',
    subjects: ['', '', '', '', '', '', '', ''],
    parentId: null,
    parentCellIndex: null,
    cards: [],
  },
};
import {
  apiLevelsToRecord,
  recordToApiLevels,
  clearMandalaLocalStorage,
} from './mandala-converters';

export interface MandalaMeta {
  focusTags: string[];
  targetLevel: string;
  language: string;
  title: string;
  /** Server-truth card count (user_local_cards ∪ user_video_states dedup'd).
   *  Used by the grid as a layout commitment so unloaded cells render skeletons. */
  cardCount: number;
  /** CP499+ pool-serve — cells with an async deficit-fill in flight. */
  fillPendingCells: number[];
  /** CP500+ — cells whose fill run completed <60s ago (grace: invalidate once). */
  fillCompletedCells: number[];
}

interface MandalaQueryShape {
  levels: Record<string, MandalaLevel>;
  meta: MandalaMeta | null;
}

const EMPTY_META: MandalaMeta = {
  fillPendingCells: [],
  fillCompletedCells: [],
  focusTags: [],
  targetLevel: 'standard',
  language: 'ko',
  title: '',
  cardCount: 0,
};

export function useMandalaQuery(mandalaId?: string | null) {
  const { isLoggedIn, isTokenReady } = useAuth();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: mandalaId ? queryKeys.mandala.detail(mandalaId) : queryKeys.mandala.all,
    queryFn: async (): Promise<MandalaQueryShape> => {
      try {
        const apiResponse = mandalaId
          ? await apiClient.getMandalaById(mandalaId)
          : await apiClient.getDefaultMandala();
        // If DB mandala exists but localStorage still has data, clean it up
        if (localStorage.getItem('mandala-root')) {
          clearMandalaLocalStorage();
        }
        return {
          levels: apiLevelsToRecord(apiResponse.mandala),
          meta: {
            focusTags: apiResponse.mandala.focusTags ?? [],
            targetLevel: apiResponse.mandala.targetLevel ?? 'standard',
            language: apiResponse.mandala.language ?? 'ko',
            title: apiResponse.mandala.title ?? '',
            cardCount: apiResponse.mandala.cardCount ?? 0,
            fillPendingCells: apiResponse.mandala.fillPendingCells ?? [],
            fillCompletedCells: apiResponse.mandala.fillCompletedCells ?? [],
          },
        };
      } catch (err: unknown) {
        // 404 means no mandala in DB — MigrationPrompt will handle localStorage migration
        if (err instanceof ApiHttpError && err.statusCode === 404) {
          return { levels: EMPTY_ROOT_LEVELS, meta: null };
        }
        throw err;
      }
    },
    enabled: isLoggedIn && isTokenReady,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    placeholderData: keepPreviousData,
  });

  const mandalaLevels = data?.levels;
  const mandalaMeta = data?.meta ?? null;

  const activeQueryKey = mandalaId ? queryKeys.mandala.detail(mandalaId) : queryKeys.mandala.all;

  const saveMutation = useMutation({
    mutationFn: async (levels: Record<string, MandalaLevel>): Promise<MandalaQueryShape> => {
      const payload = recordToApiLevels(levels);
      const apiResponse = await apiClient.upsertMandala(payload.title, payload.levels);
      return {
        levels: apiLevelsToRecord(apiResponse.mandala),
        meta: {
          focusTags: apiResponse.mandala.focusTags ?? [],
          targetLevel: apiResponse.mandala.targetLevel ?? 'standard',
          language: apiResponse.mandala.language ?? 'ko',
          title: apiResponse.mandala.title ?? '',
        },
      };
    },
    onMutate: async (levels) => {
      await queryClient.cancelQueries({ queryKey: activeQueryKey });
      const previous = queryClient.getQueryData<MandalaQueryShape>(activeQueryKey);
      queryClient.setQueryData<MandalaQueryShape>(activeQueryKey, {
        levels,
        meta: previous?.meta ?? EMPTY_META,
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(activeQueryKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: activeQueryKey });
    },
  });

  return {
    mandalaLevels: mandalaLevels && 'root' in mandalaLevels ? mandalaLevels : EMPTY_ROOT_LEVELS,
    mandalaMeta,
    isLoading,
    isSaving: saveMutation.isPending,
    error,
    saveMandala: saveMutation.mutateAsync,
  };
}

export function useMandalaList() {
  const { isLoggedIn, isTokenReady } = useAuth();

  return useQuery({
    queryKey: queryKeys.mandala.list(),
    queryFn: async () => {
      const data = await apiClient.listMandalas();
      return data;
    },
    enabled: isLoggedIn && isTokenReady,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
    // P0 hardening: mandala list is service-critical — more aggressive retry
    retry: (failureCount, error) => {
      // Never retry auth errors beyond 1
      if (
        error instanceof Error &&
        'statusCode' in error &&
        (error as { statusCode?: number }).statusCode === 401
      ) {
        return failureCount < 1;
      }
      // Retry up to 5 times for this critical query (vs default 3)
      return failureCount < 5;
    },
    retryDelay: (attempt) => Math.min(1000 * Math.pow(2, attempt), 15_000),
  });
}

export function useMandalaQuota() {
  const { isLoggedIn, isTokenReady } = useAuth();

  return useQuery({
    queryKey: queryKeys.mandala.quota(),
    queryFn: () => apiClient.getMandalaQuota(),
    enabled: isLoggedIn && isTokenReady,
    staleTime: 5 * 60_000, // 5 min — quota changes only on mandala create/delete
  });
}

export function useCreateMandala() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (title: string) => apiClient.createMandala(title),
    onSuccess: (data) => {
      // Immediately append new mandala to cached list so UI updates without waiting for refetch
      const newMandala = data?.mandala;
      if (newMandala) {
        queryClient.setQueryData(
          queryKeys.mandala.list(),
          (
            old:
              | { mandalas: MandalaResponse[]; total: number; page: number; limit: number }
              | undefined
          ) => {
            if (!old) return old;
            return {
              ...old,
              mandalas: [...old.mandalas, newMandala],
              total: old.total + 1,
            };
          }
        );
      }
    },
    onSettled: () => {
      // Always refetch for consistency (even on error)
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.quota() });
    },
  });
}

export function useDeleteMandala() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteMandala(id),
    onMutate: async (deletedId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.mandala.list() });
      const previous = queryClient.getQueryData(queryKeys.mandala.list());
      queryClient.setQueryData(
        queryKeys.mandala.list(),
        (
          old:
            | { mandalas: MandalaResponse[]; total: number; page: number; limit: number }
            | undefined
        ) => {
          if (!old) return old;
          return {
            ...old,
            mandalas: old.mandalas.filter((m) => m.id !== deletedId),
            total: Math.max(0, old.total - 1),
          };
        }
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.mandala.list(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.quota() });
    },
  });
}

export function useRenameMandala() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, title }: { id: string; title: string }) =>
      apiClient.updateMandala(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.all });
    },
  });
}

/**
 * Trigger slide-deck DATA PREP (③) — enqueues book-index + segment-relevance
 * fills for a mandala. Fire-and-forget (the jobs run async on the server); the
 * caller shows a "준비중" progress state. Does NOT render a deck (slidegen).
 */
export function useGenerateSlideDeck() {
  return useMutation({
    mutationFn: (mandalaId: string) => apiClient.generateSlideDeck(mandalaId),
  });
}

/**
 * Deck lifecycle for a mandala (③ button state). `enabled` gates the query so
 * it only runs while the row menu is open (avoids N background polls across the
 * sidebar). Polls every 3s while pending/building so 생성중→완료 flips live.
 */
export function useDeckStatus(mandalaId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['deck-status', mandalaId],
    queryFn: () => apiClient.getDeckStatus(mandalaId),
    enabled,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'pending' || s === 'building' ? 3000 : false;
    },
  });
}

export function useSwitchMandala() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.updateMandala(id, { isDefault: true }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.mandala.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.mandala.list() }),
      ]);
    },
  });
}

export function useToggleMandalaShare() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, isPublic }: { id: string; isPublic: boolean }) =>
      apiClient.toggleMandalaShare(id, isPublic),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.all });
    },
  });
}

export function useSubscriptions() {
  const { isLoggedIn, isTokenReady } = useAuth();

  return useQuery({
    queryKey: queryKeys.mandala.subscriptions(),
    queryFn: () => apiClient.listSubscriptions(1, 100),
    enabled: isLoggedIn && isTokenReady,
    staleTime: 5 * 60_000, // 5 min — subscriptions change rarely
  });
}

export function useSubscribeMandala() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (mandalaId: string) => apiClient.subscribeMandala(mandalaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.subscriptions() });
    },
  });
}

export function useUpdateSectorNames() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      mandalaId,
      centerGoal,
      subjects,
    }: {
      mandalaId: string;
      centerGoal: string;
      subjects: string[];
    }) => {
      return apiClient.updateMandalaLevels(mandalaId, [
        {
          levelKey: 'root',
          centerGoal,
          subjects,
          position: 0,
          depth: 0,
        },
      ]);
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.detail(vars.mandalaId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.list() });
    },
  });
}

export function useUnsubscribeMandala() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (mandalaId: string) => apiClient.unsubscribeMandala(mandalaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.subscriptions() });
    },
  });
}

// ========================================
// Source-Mandala Mappings
// ========================================

export function useSourceMappings() {
  const { isLoggedIn, isTokenReady } = useAuth();

  return useQuery({
    queryKey: queryKeys.mandala.sourceMappings(),
    queryFn: () => apiClient.listSourceMappings(),
    enabled: isLoggedIn && isTokenReady,
    staleTime: 5 * 60_000, // 5 min — source mappings change rarely
  });
}

export function useCreateSourceMappings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      sourceType,
      sourceIds,
      mandalaId,
    }: {
      sourceType: string;
      sourceIds: string[];
      mandalaId: string;
    }) => apiClient.createSourceMappings(sourceType, sourceIds, mandalaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.sourceMappings() });
    },
  });
}

export function useDeleteSourceMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      sourceType,
      sourceId,
      mandalaId,
    }: {
      sourceType: string;
      sourceId: string;
      mandalaId: string;
    }) => apiClient.deleteSourceMapping(sourceType, sourceId, mandalaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.sourceMappings() });
    },
  });
}
