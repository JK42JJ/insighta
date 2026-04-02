import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

import { apiClient } from '@/shared/lib/api-client';
import type { EditorBlock } from '@/shared/types/mandala-ux';

// ─── API helpers (apiClient.request is private — use fetchWithAuth pattern) ───

async function fetchWithAuth<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  await apiClient.tokenReady;
  const token = apiClient.getAccessToken();
  const baseUrl = (apiClient as unknown as { baseUrl: string }).baseUrl;
  const url = `${baseUrl}/api/v1${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Editor API error: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

interface EditDataResponse {
  blocks: EditorBlock[];
}

// ─── Hook ───

export function useEditor(mandalaId: string | undefined) {
  const queryClient = useQueryClient();

  const [currentBlockIndex, setCurrentBlockIndex] = useState(0);
  const [localBlocks, setLocalBlocks] = useState<EditorBlock[] | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Fetch edit data
  const {
    data: fetchedBlocks,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['mandala', 'edit-data', mandalaId],
    queryFn: () => fetchWithAuth<EditDataResponse>(`/mandalas/${mandalaId}/edit-data`),
    enabled: !!mandalaId,
    staleTime: 5 * 60 * 1000,
    retry: (failureCount, err: unknown) => {
      const status = (err as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 403) return false;
      return failureCount < 2;
    },
    select: (data) => data.blocks,
  });

  // Use local blocks if user has edited, otherwise use fetched data
  const blocks = localBlocks ?? fetchedBlocks ?? [];

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: (blocksToSave: EditorBlock[]) =>
      fetchWithAuth<void>(`/mandalas/${mandalaId}/edit-data`, {
        method: 'PUT',
        body: JSON.stringify({ blocks: blocksToSave }),
      }),
    onSuccess: () => {
      setIsDirty(false);
      setLocalBlocks(null); // revert to server data
      queryClient.invalidateQueries({ queryKey: ['mandala', 'edit-data', mandalaId] });
    },
  });

  // ─── Actions ───

  const setBlockItem = useCallback(
    (blockIdx: number, itemIdx: number, value: string) => {
      setLocalBlocks((prev) => {
        const base = prev ?? fetchedBlocks ?? [];
        return base.map((b, i) => {
          if (i !== blockIdx) return b;
          const items = [...b.items];
          items[itemIdx] = value;
          return { ...b, items };
        });
      });
      setIsDirty(true);
    },
    [fetchedBlocks]
  );

  const setBlockName = useCallback(
    (blockIdx: number, name: string) => {
      setLocalBlocks((prev) => {
        const base = prev ?? fetchedBlocks ?? [];
        return base.map((b, i) => (i === blockIdx ? { ...b, name } : b));
      });
      setIsDirty(true);
    },
    [fetchedBlocks]
  );

  const selectBlock = useCallback((idx: number) => {
    setCurrentBlockIndex(idx);
  }, []);

  const save = useCallback(() => {
    saveMutation.mutate(blocks);
  }, [blocks, saveMutation]);

  return {
    currentBlockIndex,
    blocks,
    isDirty,
    isLoading,
    error,
    isSaving: saveMutation.isPending,
    setBlockItem,
    setBlockName,
    selectBlock,
    save,
  };
}
