/**
 * Hooks for mandala sharing — create, list, delete share links.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';

const sharingKeys = {
  links: (mandalaId: string) => ['sharing', 'links', mandalaId] as const,
};

export function useShareLinks(mandalaId: string | undefined) {
  return useQuery({
    queryKey: sharingKeys.links(mandalaId ?? ''),
    queryFn: async () => {
      if (!mandalaId) return [];
      const result = await apiClient.listShareLinks(mandalaId);
      return result.data;
    },
    enabled: !!mandalaId,
  });
}

export function useCreateShareLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      mandalaId,
      mode,
      expiresInDays,
    }: {
      mandalaId: string;
      mode: 'view' | 'view_cards' | 'clone';
      expiresInDays?: number;
    }) => {
      const result = await apiClient.createShareLink(mandalaId, mode, expiresInDays);
      return result.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: sharingKeys.links(variables.mandalaId) });
    },
  });
}

export function useDeleteShareLink() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ shareId, mandalaId }: { shareId: string; mandalaId: string }) => {
      await apiClient.deleteShareLink(shareId);
      return mandalaId;
    },
    onSuccess: (mandalaId) => {
      queryClient.invalidateQueries({ queryKey: sharingKeys.links(mandalaId) });
    },
  });
}

export function useCloneSharedMandala() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (code: string) => {
      const result = await apiClient.cloneSharedMandala(code);
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mandalas'] });
    },
  });
}
