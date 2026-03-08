import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
