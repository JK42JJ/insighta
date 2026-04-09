/**
 * React Query wrappers for rich-note GET + PATCH.
 * Uses the feature-local fetch wrapper (rich-note-api.ts) so that
 * shared/lib/api-client.ts does NOT need to be modified.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchRichNote,
  saveRichNote,
  type RichNoteResponse,
  type SaveRichNoteResponse,
} from '../lib/rich-note-api';
import type { TiptapDoc } from '../lib/note-parser';
import { RICH_NOTE_QUERY_KEY } from '../config';

export function useRichNoteQuery(cardId: string | null) {
  return useQuery<RichNoteResponse>({
    queryKey: [RICH_NOTE_QUERY_KEY, cardId],
    queryFn: () => {
      if (!cardId) throw new Error('cardId is required');
      return fetchRichNote(cardId);
    },
    enabled: Boolean(cardId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}

export function useSaveRichNoteMutation(cardId: string | null) {
  const queryClient = useQueryClient();
  return useMutation<SaveRichNoteResponse, Error, TiptapDoc>({
    mutationFn: async (doc) => {
      if (!cardId) throw new Error('cardId is required');
      return saveRichNote(cardId, doc);
    },
    onSuccess: (result) => {
      if (!cardId) return;
      queryClient.setQueryData<RichNoteResponse | undefined>(
        [RICH_NOTE_QUERY_KEY, cardId],
        (prev) =>
          prev
            ? {
                ...prev,
                updatedAt: result.updatedAt,
              }
            : prev
      );
    },
  });
}
