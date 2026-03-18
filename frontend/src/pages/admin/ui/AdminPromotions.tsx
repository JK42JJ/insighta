import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { Plus, Pencil, Trash2, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

const STATUS_OPTIONS = ['all', 'active', 'inactive', 'expired'] as const;
const TYPE_OPTIONS = ['tier_upgrade', 'limit_increase', 'trial_extension'] as const;
const TYPE_LABELS: Record<string, string> = {
  tier_upgrade: 'Tier Upgrade',
  limit_increase: 'Limit Increase',
  trial_extension: 'Trial Extension',
};

interface CreateFormData {
  code: string;
  type: string;
  value: string;
  startsAt: string;
  endsAt: string;
  maxRedemptions: string;
}

const EMPTY_FORM: CreateFormData = { code: '', type: 'tier_upgrade', value: '{}', startsAt: '', endsAt: '', maxRedemptions: '' };

export function AdminPromotions() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<string>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateFormData>(EMPTY_FORM);
  const [editId, setEditId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'promotions', page, status],
    queryFn: () => apiClient.getAdminPromotions({ page, limit: 20, status }),
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      let parsedValue: Record<string, unknown>;
      try { parsedValue = JSON.parse(form.value); } catch { parsedValue = {}; }
      return apiClient.createAdminPromotion({
        code: form.code,
        type: form.type,
        value: parsedValue,
        startsAt: form.startsAt || undefined,
        endsAt: form.endsAt || undefined,
        maxRedemptions: form.maxRedemptions ? parseInt(form.maxRedemptions) : undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'promotions'] });
      setShowCreate(false);
      setForm(EMPTY_FORM);
    },
  });

  const updateMutation = useMutation({
    mutationFn: (id: string) => {
      let parsedValue: Record<string, unknown> | undefined;
      try { parsedValue = JSON.parse(form.value); } catch { parsedValue = undefined; }
      return apiClient.updateAdminPromotion(id, {
        code: form.code || undefined,
        type: form.type || undefined,
        value: parsedValue,
        isActive: true,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'promotions'] });
      setEditId(null);
      setForm(EMPTY_FORM);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiClient.deleteAdminPromotion(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'promotions'] }),
  });

  const items = data?.items ?? [];
  const pagination = data?.pagination;

  const startEdit = (item: Record<string, unknown>) => {
    setEditId(item['id'] as string);
    setForm({
      code: (item['code'] as string) ?? '',
      type: (item['type'] as string) ?? 'tier_upgrade',
      value: JSON.stringify(item['value'] ?? {}),
      startsAt: item['starts_at'] ? String(item['starts_at']).slice(0, 16) : '',
      endsAt: item['ends_at'] ? String(item['ends_at']).slice(0, 16) : '',
      maxRedemptions: item['max_redemptions'] != null ? String(item['max_redemptions']) : '',
    });
  };

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Promotions</h1>
        <button
          onClick={() => { setShowCreate(!showCreate); setEditId(null); setForm(EMPTY_FORM); }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New Promotion
        </button>
      </div>

      {/* Status filter */}
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

      {/* Create/Edit form */}
      {(showCreate || editId) && (
        <div className="bg-card border border-border rounded-lg p-4 mb-4 space-y-3">
          <h3 className="font-medium text-sm">{editId ? 'Edit Promotion' : 'Create Promotion'}</h3>
          <div className="grid grid-cols-2 gap-3">
            <input
              placeholder="Code (e.g. WELCOME2026)"
              value={form.code}
              onChange={e => setForm({ ...form, code: e.target.value })}
              className="px-3 py-2 rounded-md border border-border bg-background text-sm"
            />
            <select
              value={form.type}
              onChange={e => setForm({ ...form, type: e.target.value })}
              className="px-3 py-2 rounded-md border border-border bg-background text-sm"
            >
              {TYPE_OPTIONS.map(t => <option key={t} value={t}>{TYPE_LABELS[t]}</option>)}
            </select>
            <input
              placeholder='Value JSON (e.g. {"tier":"premium"})'
              value={form.value}
              onChange={e => setForm({ ...form, value: e.target.value })}
              className="px-3 py-2 rounded-md border border-border bg-background text-sm col-span-2"
            />
            <input
              type="datetime-local"
              placeholder="Starts at"
              value={form.startsAt}
              onChange={e => setForm({ ...form, startsAt: e.target.value })}
              className="px-3 py-2 rounded-md border border-border bg-background text-sm"
            />
            <input
              type="datetime-local"
              placeholder="Ends at"
              value={form.endsAt}
              onChange={e => setForm({ ...form, endsAt: e.target.value })}
              className="px-3 py-2 rounded-md border border-border bg-background text-sm"
            />
            <input
              type="number"
              placeholder="Max redemptions (optional)"
              value={form.maxRedemptions}
              onChange={e => setForm({ ...form, maxRedemptions: e.target.value })}
              className="px-3 py-2 rounded-md border border-border bg-background text-sm"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => editId ? updateMutation.mutate(editId) : createMutation.mutate()}
              disabled={createMutation.isPending || updateMutation.isPending}
              className="px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90 disabled:opacity-50"
            >
              {editId ? 'Save' : 'Create'}
            </button>
            <button
              onClick={() => { setShowCreate(false); setEditId(null); setForm(EMPTY_FORM); }}
              className="px-4 py-1.5 rounded-md bg-muted text-muted-foreground text-sm hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Code</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Type</th>
              <th className="text-center text-xs font-medium text-muted-foreground px-4 py-3">Redemptions</th>
              <th className="text-center text-xs font-medium text-muted-foreground px-4 py-3">Status</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">Ends</th>
              <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">Loading...</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-8 text-muted-foreground text-sm">No promotions found.</td></tr>
            ) : items.map(item => {
              const isActive = item['is_active'] as boolean;
              const isExpired = item['ends_at'] && new Date(item['ends_at'] as string) < new Date();
              return (
                <tr key={item['id'] as string} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-3 text-sm font-mono">{item['code'] as string}</td>
                  <td className="px-4 py-3 text-sm">{TYPE_LABELS[(item['type'] as string)] ?? item['type']}</td>
                  <td className="px-4 py-3 text-sm text-center">
                    {String(item['current_redemptions'] ?? 0)}/{item['max_redemptions'] != null ? String(item['max_redemptions']) : '∞'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={cn(
                      'px-2 py-0.5 rounded-full text-xs',
                      isExpired ? 'bg-yellow-500/20 text-yellow-400' :
                      isActive ? 'bg-green-500/20 text-green-400' :
                      'bg-red-500/20 text-red-400'
                    )}>
                      {isExpired ? 'expired' : isActive ? 'active' : 'inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">
                    {item['ends_at'] ? new Date(item['ends_at'] as string).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => startEdit(item)} className="p-1 hover:bg-accent rounded-md mr-1">
                      <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                    <button
                      onClick={() => { if (confirm('Deactivate this promotion?')) deleteMutation.mutate(item['id'] as string); }}
                      className="p-1 hover:bg-destructive/20 rounded-md"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </button>
                  </td>
                </tr>
              );
            })}
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
