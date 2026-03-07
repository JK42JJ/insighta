import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthHeaders } from '@/lib/supabase-auth';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/hooks/useAuth';
import type { MandalaLevel } from '@/types/mandala';
import { mockMandalaLevels } from '@/data/mockData';
import { parseValidatedMandalaLevel, parseValidatedSubLevel } from '@/lib/localStorageValidation';

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

function loadFromLocalStorage(): Record<string, MandalaLevel> | null {
  const root = parseValidatedMandalaLevel('mandala-root');
  if (!root) return null;

  const result: Record<string, MandalaLevel> = { root };

  const keys = Object.keys(localStorage);
  for (const key of keys) {
    if (key.startsWith('mandala-l2-')) {
      const levelKey = key.replace('mandala-l2-', '');
      const subjects = parseValidatedSubLevel(key);
      if (subjects) {
        const stored = localStorage.getItem(key);
        if (stored) {
          try {
            const parsed = JSON.parse(stored) as MandalaLevel;
            result[levelKey] = {
              id: levelKey,
              centerGoal: parsed.centerGoal || levelKey,
              subjects,
              parentId: parsed.parentId || 'root',
              parentCellIndex: parsed.parentCellIndex ?? null,
              cards: [],
            };
          } catch {
            // Skip corrupted entries
          }
        }
      }
    }
  }

  return result;
}

function clearLocalStorage(): void {
  localStorage.removeItem('mandala-root');
  const keys = Object.keys(localStorage);
  for (const key of keys) {
    if (key.startsWith('mandala-l2-')) {
      localStorage.removeItem(key);
    }
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
        // No mandala in DB — check localStorage for migration
        const localData = loadFromLocalStorage();
        if (localData) {
          // Migrate localStorage → DB
          const payload = recordToApiLevels(localData);
          const putResponse = await fetch('/api/v1/mandalas', {
            method: 'PUT',
            headers,
            body: JSON.stringify(payload),
          });

          if (putResponse.ok) {
            clearLocalStorage();
            const data = await putResponse.json();
            // Cards were linked to this mandala — invalidate card caches
            if (data.linked) {
              queryClient.invalidateQueries({ queryKey: queryKeys.localCards.all });
              queryClient.invalidateQueries({ queryKey: ['youtube', 'all-video-states'] });
            }
            return apiLevelsToRecord(data.mandala);
          }
        }

        // Return defaults if migration failed or no local data
        return mockMandalaLevels;
      }

      if (!response.ok) {
        throw new Error('Failed to fetch mandala');
      }

      const data = await response.json();
      // If DB mandala exists but localStorage still has data, clean it up
      if (localStorage.getItem('mandala-root')) {
        clearLocalStorage();
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
