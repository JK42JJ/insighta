import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { queryKeys } from '@/shared/config/query-client';
import { useAuth } from '@/features/auth/model/useAuth';
import { mockMandalaLevels } from '@/shared/data/mockData';
import type { MandalaLevel } from '@/entities/card/model/types';
import { apiLevelsToRecord, recordToApiLevels, clearMandalaLocalStorage } from './mandala-converters';

export function useMandalaQuery() {
  const { isLoggedIn } = useAuth();
  const queryClient = useQueryClient();

  const {
    data: mandalaLevels,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.mandala.all,
    queryFn: async (): Promise<Record<string, MandalaLevel>> => {
      try {
        const data = await apiClient.getDefaultMandala();
        // If DB mandala exists but localStorage still has data, clean it up
        if (localStorage.getItem('mandala-root')) {
          clearMandalaLocalStorage();
        }
        return apiLevelsToRecord(data.mandala);
      } catch (err: unknown) {
        // 404 means no mandala in DB — MigrationPrompt will handle localStorage migration
        if (err instanceof Error && err.message.includes('404')) {
          return mockMandalaLevels;
        }
        throw err;
      }
    },
    enabled: isLoggedIn,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: async (levels: Record<string, MandalaLevel>) => {
      const payload = recordToApiLevels(levels);
      const data = await apiClient.upsertMandala(payload.title, payload.levels);
      return apiLevelsToRecord(data.mandala);
    },
    onMutate: async (levels) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.mandala.all });
      const previous = queryClient.getQueryData<Record<string, MandalaLevel>>(queryKeys.mandala.all);
      queryClient.setQueryData(queryKeys.mandala.all, levels);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.mandala.all, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.all });
    },
  });

  return {
    mandalaLevels: mandalaLevels ?? mockMandalaLevels,
    isLoading,
    isSaving: saveMutation.isPending,
    error,
    saveMandala: saveMutation.mutateAsync,
  };
}

export function useMandalaList() {
  const { isLoggedIn } = useAuth();

  return useQuery({
    queryKey: queryKeys.mandala.list(),
    queryFn: async () => {
      const data = await apiClient.listMandalas();
      return data;
    },
    enabled: isLoggedIn,
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });
}

export function useMandalaQuota() {
  const { isLoggedIn } = useAuth();

  return useQuery({
    queryKey: queryKeys.mandala.quota(),
    queryFn: () => apiClient.getMandalaQuota(),
    enabled: isLoggedIn,
    staleTime: 60_000,
  });
}

export function useCreateMandala() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (title: string) => apiClient.createMandala(title),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.list() });
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.quota() });
    },
  });
}

export function useDeleteMandala() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.deleteMandala(id),
    onSuccess: () => {
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
  const { isLoggedIn } = useAuth();

  return useQuery({
    queryKey: queryKeys.mandala.subscriptions(),
    queryFn: () => apiClient.listSubscriptions(1, 100),
    enabled: isLoggedIn,
    staleTime: 30_000,
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

export function useUnsubscribeMandala() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (mandalaId: string) => apiClient.unsubscribeMandala(mandalaId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala.subscriptions() });
    },
  });
}
