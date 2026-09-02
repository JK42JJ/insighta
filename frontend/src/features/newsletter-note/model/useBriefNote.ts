/**
 * A published brief, ready for the note surface.
 *
 * Fetches the issue as data and converts it once. The conversion is pure and
 * cheap, but it runs on every render without the memo, and the note editor is
 * rebuilt whenever its document identity changes — so a new object each render
 * would reset the reader's scroll position on every keystroke elsewhere in the
 * app.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';

import { apiClient } from '@/shared/lib/api-client';
import type { TiptapDoc } from '@/features/video-side-panel/lib/note-parser';
import type { IssueDocument } from '../lib/issue-types';
import { issueToNoteDoc } from '../lib/issue-to-note';

export interface BriefNote {
  issue: IssueDocument | null;
  doc: TiptapDoc | null;
  loading: boolean;
  /** True when the slug does not resolve — a draft, or a typo in a link. */
  notFound: boolean;
  error: boolean;
}

export function useBriefNote(slug: string | undefined): BriefNote {
  const query = useQuery({
    queryKey: ['brief-document', slug],
    queryFn: async () => {
      const res = await apiClient.getBriefDocument(slug as string);
      if (res.status !== 'ok' || !res.data) throw new Error(res.error ?? 'failed');
      return res.data.issue as IssueDocument;
    },
    enabled: !!slug,
    // A published issue does not change. Refetching it on every focus costs a
    // request and can only ever return the same document.
    staleTime: 60 * 60 * 1000,
    retry: 1,
  });

  const doc = useMemo(() => (query.data ? issueToNoteDoc(query.data) : null), [query.data]);

  return {
    issue: query.data ?? null,
    doc,
    loading: query.isLoading,
    notFound: query.isError && /not found|404/i.test(String(query.error)),
    error: query.isError,
  };
}
