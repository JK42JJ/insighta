import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { Search, ChevronLeft, ChevronRight, Shield, Ban } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

export function AdminUsers() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<string>('');
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', page, search, tierFilter],
    queryFn: () =>
      apiClient.getAdminUsers({
        page,
        limit: 20,
        search: search || undefined,
        tier: tierFilter || undefined,
      }),
    staleTime: 30 * 1000,
  });

  const { data: userDetail } = useQuery({
    queryKey: ['admin', 'user', selectedUserId],
    queryFn: () => apiClient.getAdminUser(selectedUserId!),
    enabled: !!selectedUserId,
  });

  const tierMutation = useMutation({
    mutationFn: ({ id, tier }: { id: string; tier: string }) =>
      apiClient.updateUserSubscription(id, { tier }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, banned }: { id: string; banned: boolean }) =>
      apiClient.updateUserStatus(id, { banned }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin'] });
    },
  });

  const users = data?.items ?? [];
  const pagination = data?.pagination;

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6">Users</h2>

      {/* Search & Filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by email or name..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-background text-sm"
          />
        </div>
        <select
          value={tierFilter}
          onChange={(e) => {
            setTierFilter(e.target.value);
            setPage(1);
          }}
          className="px-3 py-2 rounded-md border border-border bg-background text-sm"
        >
          <option value="">All tiers</option>
          <option value="free">Free</option>
          <option value="premium">Premium</option>
          <option value="admin">Admin</option>
        </select>
      </div>

      {/* Users Table */}
      <div className="rounded-lg border border-border overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/50">
            <tr>
              <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">User</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Tier</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Cards</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Mandalas</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Joined</th>
              <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  <td colSpan={6} className="px-4 py-3">
                    <div className="h-4 bg-muted rounded animate-pulse" />
                  </td>
                </tr>
              ))
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const uid = user.id as string;
                const isBanned = !!user.banned_until;
                return (
                  <tr
                    key={uid}
                    className={cn(
                      'hover:bg-muted/30 cursor-pointer transition-colors',
                      selectedUserId === uid && 'bg-primary/5'
                    )}
                    onClick={() => setSelectedUserId(uid)}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {user.avatar_url ? (
                          <img
                            src={user.avatar_url as string}
                            alt=""
                            className="h-7 w-7 rounded-full"
                          />
                        ) : (
                          <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center text-xs">
                            {((user.name as string) || (user.email as string))?.[0]?.toUpperCase()}
                          </div>
                        )}
                        <div>
                          <p className="text-sm font-medium">{(user.name as string) || '—'}</p>
                          <p className="text-xs text-muted-foreground">{user.email as string}</p>
                        </div>
                        {user.is_super_admin && (
                          <Shield className="h-3.5 w-3.5 text-primary" />
                        )}
                        {isBanned && <Ban className="h-3.5 w-3.5 text-destructive" />}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'text-xs px-2 py-0.5 rounded-full',
                          user.tier === 'admin' && 'bg-primary/10 text-primary',
                          user.tier === 'premium' && 'bg-amber-500/10 text-amber-500',
                          user.tier === 'free' && 'bg-muted text-muted-foreground'
                        )}
                      >
                        {user.tier as string}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">{String(user.card_count)}</td>
                    <td className="px-4 py-3 text-sm">{String(user.mandala_count)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {new Date(user.created_at as string).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={user.tier as string}
                          onChange={(e) =>
                            tierMutation.mutate({ id: uid, tier: e.target.value })
                          }
                          className="text-xs px-1.5 py-1 rounded border border-border bg-background"
                        >
                          <option value="free">Free</option>
                          <option value="premium">Premium</option>
                          <option value="admin">Admin</option>
                        </select>
                        <button
                          onClick={() =>
                            statusMutation.mutate({ id: uid, banned: !isBanned })
                          }
                          className={cn(
                            'text-xs px-2 py-1 rounded',
                            isBanned
                              ? 'bg-green-500/10 text-green-600 hover:bg-green-500/20'
                              : 'bg-destructive/10 text-destructive hover:bg-destructive/20'
                          )}
                        >
                          {isBanned ? 'Unban' : 'Ban'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-muted-foreground">
            {pagination.total} users, page {pagination.page} of {pagination.totalPages}
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={!pagination.hasPrev}
              className="p-1.5 rounded border border-border disabled:opacity-30"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={!pagination.hasNext}
              className="p-1.5 rounded border border-border disabled:opacity-30"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* User Detail Drawer */}
      {selectedUserId && userDetail?.data && (
        <div className="fixed right-0 top-0 h-full w-80 bg-card border-l border-border shadow-lg p-4 overflow-auto z-50">
          <button
            onClick={() => setSelectedUserId(null)}
            className="text-xs text-muted-foreground hover:text-foreground mb-4"
          >
            Close
          </button>
          <h3 className="font-semibold mb-2">
            {(userDetail.data.name as string) || (userDetail.data.email as string)}
          </h3>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="text-muted-foreground text-xs">Email</dt>
              <dd>{userDetail.data.email as string}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Tier</dt>
              <dd className="capitalize">{userDetail.data.tier as string}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Card Limit</dt>
              <dd>{String(userDetail.data.local_cards_limit)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Mandala Limit</dt>
              <dd>{String(userDetail.data.mandala_limit)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Cards / Mandalas</dt>
              <dd>
                {String(userDetail.data.card_count)} / {String(userDetail.data.mandala_count)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Joined</dt>
              <dd>{new Date(userDetail.data.created_at as string).toLocaleString()}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground text-xs">Last Sign In</dt>
              <dd>
                {userDetail.data.last_sign_in_at
                  ? new Date(userDetail.data.last_sign_in_at as string).toLocaleString()
                  : 'Never'}
              </dd>
            </div>
          </dl>
        </div>
      )}
    </div>
  );
}
