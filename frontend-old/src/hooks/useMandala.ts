import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthHeaders } from '@/lib/supabase-auth';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/hooks/useAuth';
import type { MandalaLevel } from '@/types/mandala';
import { mockMandalaLevels } from '@/data/mockData';

interface MandalaLevelApi {
  id: string;
  levelKey: string;
  centerGoal: string;
  subjects: string[];
  position: number;
  depth: number;
  color: string | null;
  parentLevelId: string | null;
}

interface MandalaApi {
  id: string;
  title: string;
  isDefault: boolean;
  levels: MandalaLevelApi[];
}

function apiLevelsToRecord(apiMandala: MandalaApi): Record<string, MandalaLevel> {
  const result: Record<string, MandalaLevel> = {};

  for (const level of apiMandala.levels) {
    const parentLevel = level.parentLevelId
      ? apiMandala.levels.find((l) => l.id === level.parentLevelId)
      : null;

    result[level.levelKey] = {
      id: level.levelKey,
      centerGoal: level.centerGoal,
      subjects: level.subjects,
      parentId: parentLevel?.levelKey ?? null,
      parentCellIndex: level.depth > 0 ? level.position : null,
      cards: [],
    };
  }

  return result;
}

function recordToApiLevels(levels: Record<string, MandalaLevel>): {
  title: string;
  levels: Array<{
    levelKey: string;
    centerGoal: string;
    subjects: string[];
    position: number;
    depth: number;
    parentLevelKey: string | null;
  }>;
} {
  const root = levels['root'];
  const apiLevels = [];

  // Root level
  if (root) {
    apiLevels.push({
      levelKey: 'root',
      centerGoal: root.centerGoal,
      subjects: root.subjects,
      position: 0,
      depth: 0,
      parentLevelKey: null,
    });
  }

  // L2 levels
  for (const [key, level] of Object.entries(levels)) {
    if (key === 'root') continue;
    apiLevels.push({
      levelKey: key,
      centerGoal: level.centerGoal,
      subjects: level.subjects,
      position: level.parentCellIndex ?? 0,
      depth: 1,
      parentLevelKey: level.parentId ?? 'root',
    });
  }

  return {
    title: root?.centerGoal ?? 'My Mandala',
    levels: apiLevels,
  };
}

function clearMandalaLocalStorage(): void {
  localStorage.removeItem('mandala-root');
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('mandala-l2-')) localStorage.removeItem(key);
  }
}

export function useMandala() {
  const { isLoggedIn } = useAuth();
  const queryClient = useQueryClient();

  const {
    data: mandalaLevels,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.mandala,
    queryFn: async (): Promise<Record<string, MandalaLevel>> => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/v1/mandalas', { headers });

      if (response.status === 404) {
        // No mandala in DB — MigrationPrompt will handle localStorage migration
        return mockMandalaLevels;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch mandala');
      }

      const data = await response.json();
      // If DB mandala exists but localStorage still has data, clean it up
      if (localStorage.getItem('mandala-root')) {
        clearMandalaLocalStorage();
      }
      return apiLevelsToRecord(data.mandala);
    },
    enabled: isLoggedIn,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
  });

  const saveMutation = useMutation({
    mutationFn: async (levels: Record<string, MandalaLevel>) => {
      const headers = await getAuthHeaders();
      const payload = recordToApiLevels(levels);
      const response = await fetch('/api/v1/mandalas', {
        method: 'PUT',
        headers,
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error('Failed to save mandala');
      }

      const data = await response.json();
      return apiLevelsToRecord(data.mandala);
    },
    onMutate: async (levels) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.mandala });
      const previous = queryClient.getQueryData<Record<string, MandalaLevel>>(queryKeys.mandala);
      queryClient.setQueryData(queryKeys.mandala, levels);
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.mandala, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala });
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
