import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getAuthHeaders } from '@/lib/supabase-auth';
import { queryKeys } from '@/lib/queryKeys';
import { useAuth } from '@/hooks/useAuth';

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

export interface MandalaListItem {
  id: string;
  title: string;
  isDefault: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  levelCount: number;
}

interface MandalaApiItem {
  id: string;
  title: string;
  isDefault: boolean;
  position: number;
  createdAt: string;
  updatedAt: string;
  levels: MandalaLevelApi[];
}

interface MandalaQuota {
  tier: string;
  limit: number;
  used: number;
  remaining: number;
}

function toListItem(m: MandalaApiItem): MandalaListItem {
  return {
    id: m.id,
    title: m.title,
    isDefault: m.isDefault,
    position: m.position,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    levelCount: m.levels.length,
  };
}

export function useMandalas() {
  const { isLoggedIn } = useAuth();
  const queryClient = useQueryClient();

  const {
    data: mandalasData,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.mandalas.list,
    queryFn: async () => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/v1/mandalas/list', { headers });

      if (!response.ok) {
        throw new Error('Failed to fetch mandalas');
      }

      const data = await response.json();
      return {
        mandalas: (data.mandalas as MandalaApiItem[]).map(toListItem),
        total: data.total as number,
      };
    },
    enabled: isLoggedIn,
    staleTime: 60_000,
  });

  const quotaQuery = useQuery({
    queryKey: queryKeys.mandalas.quota,
    queryFn: async (): Promise<MandalaQuota> => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/v1/mandalas/quota', { headers });

      if (!response.ok) {
        throw new Error('Failed to fetch quota');
      }

      const data = await response.json();
      return data.quota;
    },
    enabled: isLoggedIn,
    staleTime: 5 * 60_000,
  });

  const createMutation = useMutation({
    mutationFn: async (title: string) => {
      const headers = await getAuthHeaders();
      const response = await fetch('/api/v1/mandalas/create', {
        method: 'POST',
        headers,
        body: JSON.stringify({ title }),
      });

      if (response.status === 409) {
        const data = await response.json();
        throw new Error(data.error || 'Mandala quota exceeded');
      }

      if (!response.ok) {
        throw new Error('Failed to create mandala');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mandalas.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (mandalaId: string) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/v1/mandalas/${mandalaId}`, {
        method: 'DELETE',
        headers,
      });

      if (!response.ok && response.status !== 204) {
        throw new Error('Failed to delete mandala');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mandalas.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala });
      // Cards are moved to default mandala on delete, invalidate card caches
      queryClient.invalidateQueries({ queryKey: ['youtube', 'all-video-states'] });
      queryClient.invalidateQueries({ queryKey: ['local-cards', 'list'] });
    },
  });

  const setDefaultMutation = useMutation({
    mutationFn: async (mandalaId: string) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/v1/mandalas/${mandalaId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ isDefault: true }),
      });

      if (!response.ok) {
        throw new Error('Failed to set default mandala');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mandalas.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala });
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ mandalaId, title }: { mandalaId: string; title: string }) => {
      const headers = await getAuthHeaders();
      const response = await fetch(`/api/v1/mandalas/${mandalaId}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ title }),
      });

      if (!response.ok) {
        throw new Error('Failed to rename mandala');
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mandalas.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.mandala });
    },
  });

  return {
    mandalas: mandalasData?.mandalas ?? [],
    total: mandalasData?.total ?? 0,
    quota: quotaQuery.data ?? null,
    isLoading,
    isQuotaLoading: quotaQuery.isLoading,
    error,
    createMandala: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    deleteMandala: deleteMutation.mutateAsync,
    isDeleting: deleteMutation.isPending,
    setDefaultMandala: setDefaultMutation.mutateAsync,
    isSettingDefault: setDefaultMutation.isPending,
    renameMandala: renameMutation.mutateAsync,
    isRenaming: renameMutation.isPending,
  };
}
