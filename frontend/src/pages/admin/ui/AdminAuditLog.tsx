import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

const ACTION_COLORS: Record<string, string> = {
  create_promotion: 'bg-green-500/20 text-green-400',
  update_promotion: 'bg-blue-500/20 text-blue-400',
  delete_promotion: 'bg-red-500/20 text-red-400',
  bulk_user_update: 'bg-purple-500/20 text-purple-400',
  update_subscription: 'bg-yellow-500/20 text-yellow-400',
  update_status: 'bg-orange-500/20 text-orange-400',
};

export function AdminAuditLog() {
  const [page, setPage] = useState(1);
  const [actionFilter, setActionFilter] = useState('');
  const [targetTypeFilter, setTargetTypeFilter] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'audit-log', page, actionFilter, targetTypeFilter],
    queryFn: () =>
      apiClient.getAdminAuditLog({
        page,
        limit: 30,
        action: actionFilter || undefined,
        targetType: targetTypeFilter || undefined,
      }),
    staleTime: 15_000,
  });

  const items = data?.items ?? [];
  const pagination = data?.pagination;

  return (
    <div className="p-6 max-w-6xl">
      <h1 className="text-2xl font-bold text-foreground mb-6">Audit Log</h1>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input
          placeholder="Filter by action..."
          value={actionFilter}
          onChange={e => { setActionFilter(e.target.value); setPage(1); }}
          className="px-3 py-1.5 rounded-md border border-border bg-background text-sm w-48"
        />
        <select
          value={targetTypeFilter}
          onChange={e => { setTargetTypeFilter(e.target.value); setPage(1); }}
          className="px-3 py-1.5 rounded-md border border-border bg-background text-sm"
        >
          <option value="">All targets</option>
          <option value="promotion">Promotion</option>
          <option value="user">User</option>
          <option value="subscription">Subscription</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Time</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Admin</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Action</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Target</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Details</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground text-sm">Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-8 text-muted-foreground text-sm">No audit entries found.</td></tr>
            ) : items.map(item => (
              <tr key={item['id'] as string} className="border-b border-border last:border-0 hover:bg-muted/20">
                <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                  {new Date(item['created_at'] as string).toLocaleString()}
                </td>
                <td className="px-4 py-3 text-sm">{(item['admin_email'] as string) ?? 'Unknown'}</td>
                <td className="px-4 py-3">
                  <span className={cn(
                    'px-2 py-0.5 rounded-full text-xs',
                    ACTION_COLORS[item['action'] as string] ?? 'bg-muted text-muted-foreground'
                  )}>
                    {(item['action'] as string).replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {item['target_type'] as string}
                  {item['target_id'] ? ` #${(item['target_id'] as string).slice(0, 8)}` : ''}
                </td>
                <td className="px-4 py-3 text-xs text-muted-foreground max-w-xs truncate">
                  {item['new_value'] ? JSON.stringify(item['new_value']).slice(0, 80) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-sm text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages} ({pagination.total} total)
          </span>
          <div className="flex gap-1">
            <button disabled={!pagination.hasPrev} onClick={() => setPage(p => p - 1)} className="p-1.5 rounded-md hover:bg-accent disabled:opacity-30"><ChevronLeft className="h-4 w-4" /></button>
            <button disabled={!pagination.hasNext} onClick={() => setPage(p => p + 1)} className="p-1.5 rounded-md hover:bg-accent disabled:opacity-30"><ChevronRight className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
