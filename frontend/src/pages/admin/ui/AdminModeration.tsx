import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { ChevronLeft, ChevronRight, Eye, EyeOff, Trash2, CheckCircle, XCircle } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

const STATUS_OPTIONS = ['all', 'pending', 'reviewed', 'resolved', 'dismissed'] as const;
const REASON_COLORS: Record<string, string> = {
  spam: 'bg-red-500/20 text-red-400',
  inappropriate: 'bg-orange-500/20 text-orange-400',
  copyright: 'bg-purple-500/20 text-purple-400',
  other: 'bg-muted text-muted-foreground',
};

export function AdminModeration() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'reports' | 'content'>('reports');
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>('pending');
  const [contentSearch, setContentSearch] = useState('');
  const [contentPage, setContentPage] = useState(1);

  // Reports
  const { data: reportsData, isLoading: reportsLoading } = useQuery({
    queryKey: ['admin', 'reports', page, status],
    queryFn: () => apiClient.getAdminReports({ page, limit: 20, status }),
    enabled: tab === 'reports',
    staleTime: 15_000,
  });

  const resolveMutation = useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: string; note?: string }) =>
      apiClient.resolveAdminReport(id, { status, resolutionNote: note }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'reports'] }),
  });

  // Content
  const { data: contentData, isLoading: contentLoading } = useQuery({
    queryKey: ['admin', 'content', 'mandalas', contentPage, contentSearch],
    queryFn: () => apiClient.getAdminContent({ page: contentPage, limit: 20, search: contentSearch || undefined }),
    enabled: tab === 'content',
    staleTime: 30_000,
  });

  const hideMutation = useMutation({
    mutationFn: ({ id, hidden }: { id: string; hidden: boolean }) =>
      apiClient.moderateAdminContent(id, { hidden }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'content'] }),
  });

  const deleteContentMutation = useMutation({
    mutationFn: (id: string) => apiClient.deleteAdminContent(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'content'] }),
  });

  const reports = reportsData?.items ?? [];
  const reportsPagination = reportsData?.pagination;
  const mandalas = contentData?.items ?? [];
  const contentPagination = contentData?.pagination;

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-2xl font-bold text-foreground mb-6">Content Moderation</h1>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-border">
        {(['reports', 'content'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm capitalize -mb-px',
              tab === t ? 'border-b-2 border-primary text-primary font-medium' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t === 'reports' ? 'Reports' : 'Content'}
          </button>
        ))}
      </div>

      {tab === 'reports' && (
        <>
          <div className="flex gap-2 mb-4">
            {STATUS_OPTIONS.map(s => (
              <button
                key={s}
                onClick={() => { setStatus(s); setPage(1); }}
                className={cn(
                  'px-3 py-1 rounded-full text-xs capitalize',
                  status === s ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:bg-accent'
                )}
              >
                {s}
              </button>
            ))}
          </div>

          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Reporter</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Target</th>
                  <th className="text-center text-xs font-medium text-muted-foreground px-4 py-3">Reason</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Description</th>
                  <th className="text-center text-xs font-medium text-muted-foreground px-4 py-3">Status</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {reportsLoading ? (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Loading...</td></tr>
                ) : reports.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No reports found.</td></tr>
                ) : reports.map(r => (
                  <tr key={r['id'] as string} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-3 text-sm">{r['reporter_email'] as string}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {r['target_type'] as string} #{(r['target_id'] as string).slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn('px-2 py-0.5 rounded-full text-xs', REASON_COLORS[r['reason'] as string] ?? REASON_COLORS['other'])}>
                        {r['reason'] as string}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs truncate">
                      {(r['description'] as string) ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn(
                        'px-2 py-0.5 rounded-full text-xs',
                        r['status'] === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
                        r['status'] === 'resolved' ? 'bg-green-500/20 text-green-400' :
                        'bg-muted text-muted-foreground'
                      )}>
                        {r['status'] as string}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r['status'] === 'pending' && (
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={() => resolveMutation.mutate({ id: r['id'] as string, status: 'resolved' })}
                            className="p-1 hover:bg-green-500/20 rounded-md"
                            title="Resolve"
                          >
                            <CheckCircle className="h-3.5 w-3.5 text-green-400" />
                          </button>
                          <button
                            onClick={() => resolveMutation.mutate({ id: r['id'] as string, status: 'dismissed' })}
                            className="p-1 hover:bg-muted rounded-md"
                            title="Dismiss"
                          >
                            <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {reportsPagination && reportsPagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-muted-foreground">Page {reportsPagination.page}/{reportsPagination.totalPages}</span>
              <div className="flex gap-1">
                <button disabled={!reportsPagination.hasPrev} onClick={() => setPage(p => p - 1)} className="p-1.5 rounded-md hover:bg-accent disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                <button disabled={!reportsPagination.hasNext} onClick={() => setPage(p => p + 1)} className="p-1.5 rounded-md hover:bg-accent disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'content' && (
        <>
          <input
            placeholder="Search by title or email..."
            value={contentSearch}
            onChange={e => { setContentSearch(e.target.value); setContentPage(1); }}
            className="px-3 py-2 rounded-md border border-border bg-background text-sm w-72 mb-4"
          />

          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Title</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Owner</th>
                  <th className="text-center text-xs font-medium text-muted-foreground px-4 py-3">Levels</th>
                  <th className="text-center text-xs font-medium text-muted-foreground px-4 py-3">Public</th>
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Created</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {contentLoading ? (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Loading...</td></tr>
                ) : mandalas.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No content found.</td></tr>
                ) : mandalas.map(m => (
                  <tr key={m['id'] as string} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-3 text-sm font-medium">{m['title'] as string}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{(m['owner_name'] || m['owner_email']) as string}</td>
                    <td className="px-4 py-3 text-sm text-center">{String(m['level_count'] ?? 0)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={cn(
                        'px-2 py-0.5 rounded-full text-xs',
                        m['is_public'] ? 'bg-green-500/20 text-green-400' : 'bg-muted text-muted-foreground'
                      )}>
                        {m['is_public'] ? 'public' : 'private'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(m['created_at'] as string).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => hideMutation.mutate({ id: m['id'] as string, hidden: !!m['is_public'] })}
                        className="p-1 hover:bg-accent rounded-md mr-1"
                        title={m['is_public'] ? 'Hide' : 'Show'}
                      >
                        {m['is_public'] ? <EyeOff className="h-3.5 w-3.5 text-muted-foreground" /> : <Eye className="h-3.5 w-3.5 text-muted-foreground" />}
                      </button>
                      <button
                        onClick={() => { if (confirm('Permanently delete this mandala?')) deleteContentMutation.mutate(m['id'] as string); }}
                        className="p-1 hover:bg-destructive/20 rounded-md"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {contentPagination && contentPagination.totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <span className="text-sm text-muted-foreground">Page {contentPagination.page}/{contentPagination.totalPages}</span>
              <div className="flex gap-1">
                <button disabled={!contentPagination.hasPrev} onClick={() => setContentPage(p => p - 1)} className="p-1.5 rounded-md hover:bg-accent disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
                <button disabled={!contentPagination.hasNext} onClick={() => setContentPage(p => p + 1)} className="p-1.5 rounded-md hover:bg-accent disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
