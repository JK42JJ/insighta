/**
 * useMandalaBook — fetch the PoC book index for a mandala.
 *
 * CP438+1 — wraps `GET /api/v1/mandalas/:id/book`. 404 → null (book
 * not yet generated; sidebar shows "보고서 작성 준비중..." placeholder).
 *
 * Read-only. Generation runs offline via scripts/book-poc/* — endpoint
 * never triggers it.
 */

import { useQuery } from '@tanstack/react-query';
import { apiClient, type MandalaBookResponse } from '@/shared/lib/api-client';

const MANDALA_BOOK_STALE_MS = 5 * 60 * 1000;

export interface UseMandalaBookResult {
  book: MandalaBookResponse | null;
  isLoading: boolean;
  isError: boolean;
}

export function useMandalaBook(mandalaId: string | null | undefined): UseMandalaBookResult {
  const { data, isLoading, isError } = useQuery({
    queryKey: mandalaId ? ['mandala', 'book', mandalaId] : ['mandala', 'book', 'disabled'],
    queryFn: () => apiClient.getMandalaBook(mandalaId as string),
    enabled: Boolean(mandalaId),
    staleTime: MANDALA_BOOK_STALE_MS,
    retry: false,
  });

  return {
    book: data ?? null,
    isLoading,
    isError,
  };
}
