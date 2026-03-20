import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { Users, CreditCard, Grid3X3, TrendingUp, Bot } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

type DatePreset = 'today' | '7d' | '30d' | 'custom';

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  return `${local[0]}***@${domain}`;
}

function formatDateParam(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getDateRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  const to = formatDateParam(now);
  switch (preset) {
    case 'today':
      return { from: to, to };
    case '7d':
      return { from: formatDateParam(new Date(now.getTime() - 6 * 86400000)), to };
    case '30d':
      return { from: formatDateParam(new Date(now.getTime() - 29 * 86400000)), to };
    default:
      return { from: formatDateParam(new Date(now.getTime() - 6 * 86400000)), to };
  }
}

export function AdminDashboard() {
  const [datePreset, setDatePreset] = useState<DatePreset>('7d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [selectedUserId, setSelectedUserId] = useState<string>('');

  const dateRange = useMemo(() => {
    if (datePreset === 'custom' && customFrom && customTo) {
      return { from: customFrom, to: customTo };
    }
    return getDateRange(datePreset);
  }, [datePreset, customFrom, customTo]);

  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'stats'],
    queryFn: () => apiClient.getAdminStats(),
    staleTime: 60 * 1000,
  });

  const { data: llmData } = useQuery({
    queryKey: ['admin', 'llm'],
    queryFn: () => apiClient.getAdminLlm(),
    staleTime: 30 * 1000,
  });

  const { data: activityData, isLoading: activityLoading } = useQuery({
    queryKey: ['admin', 'activity', dateRange.from, dateRange.to, selectedUserId],
    queryFn: () =>
      apiClient.getAdminActivity({
        from: dateRange.from,
        to: dateRange.to,
        userId: selectedUserId || undefined,
      }),
    staleTime: 30 * 1000,
  });

  const { data: usersData } = useQuery({
    queryKey: ['admin', 'users-list'],
    queryFn: () => apiClient.getAdminUsers({ limit: 100 }),
    staleTime: 5 * 60 * 1000,
  });

  if (isLoading) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-6">Dashboard</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-28 bg-card border border-border rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !data?.data) {
    return (
      <div className="p-6">
        <h2 className="text-2xl font-bold mb-4">Dashboard</h2>
        <p className="text-destructive">Failed to load stats.</p>
      </div>
    );
  }

  const stats = data.data;
  const llm = llmData?.data;
  const activity = activityData?.data ?? [];
  const userList = ((usersData as unknown as { items?: Array<{ id: string; email: string }> })?.items ?? []);

  // OpenRouter health info
  const orHealth = llm?.health.openrouter;
  const orAvailable = typeof orHealth === 'object' && orHealth !== null ? orHealth.available : !!orHealth;
  const orLatency = typeof orHealth === 'object' && orHealth !== null ? orHealth.latencyMs : null;
  const orCredits = typeof orHealth === 'object' && orHealth !== null ? orHealth.credits : null;

  const statCards = [
    {
      label: 'Total Users',
      value: stats.users.total,
      icon: Users,
      detail: `${stats.users.active} active (30d)`,
    },
    {
      label: 'Total Cards',
      value: stats.content.totalCards,
      icon: CreditCard,
      detail: null,
    },
    {
      label: 'Total Mandalas',
      value: stats.content.totalMandalas,
      icon: Grid3X3,
      detail: null,
    },
    {
      label: 'New Signups (7d)',
      value: stats.recentSignups.reduce((sum, d) => sum + d.count, 0),
      icon: TrendingUp,
      detail: null,
    },
  ];

  // KPI rows
  const kpiRows = [
    { category: 'Users', metric: 'Total Users', value: stats.users.total, detail: `${stats.users.active} active` },
    { category: 'Users', metric: 'New Signups (7d)', value: stats.recentSignups.reduce((sum, d) => sum + d.count, 0), detail: '' },
    { category: 'Content', metric: 'Local Cards', value: stats.content.totalCards, detail: '' },
    { category: 'Content', metric: 'Synced Cards', value: stats.kpi.totalSyncedCards, detail: '' },
    { category: 'Content', metric: 'Mandalas', value: stats.content.totalMandalas, detail: '' },
    { category: 'Content', metric: 'Notes', value: stats.kpi.totalNotes, detail: 'w/ memo' },
    { category: 'AI', metric: 'Total Summaries', value: stats.kpi.totalSummaries, detail: '' },
    { category: 'AI', metric: 'Summaries Today', value: stats.kpi.summariesToday, detail: '' },
    { category: 'AI', metric: 'Summaries (7d)', value: stats.kpi.summariesWeek, detail: '' },
    { category: 'Sync', metric: 'Playlists', value: stats.kpi.totalSyncedPlaylists, detail: '' },
    { category: 'LLM', metric: 'Provider', value: llm?.active.generation.provider ?? '—', detail: llm?.active.generation.model ?? '' },
    { category: 'LLM', metric: 'Status', value: orAvailable ? 'OK' : 'Down', detail: orLatency != null ? `${orLatency}ms` : '' },
    { category: 'LLM', metric: 'Credits', value: orCredits ?? '—', detail: '' },
  ];

  return (
    <div className="p-6">
      <h2 className="text-2xl font-bold mb-6">Dashboard</h2>

      {/* Stat Cards + LLM Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        {statCards.map((card) => (
          <div
            key={card.label}
            className="bg-card border border-border rounded-lg p-4 flex items-start gap-3"
          >
            <div className="p-2 rounded-md bg-primary/10">
              <card.icon className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{card.label}</p>
              <p className="text-2xl font-bold">{card.value.toLocaleString()}</p>
              {card.detail && (
                <p className="text-xs text-muted-foreground mt-0.5">{card.detail}</p>
              )}
            </div>
          </div>
        ))}
        {/* LLM Status Card */}
        <div className="bg-card border border-border rounded-lg p-4 flex items-start gap-3">
          <div className="p-2 rounded-md bg-primary/10">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-sm text-muted-foreground">LLM Status</p>
            <div className="flex items-center gap-1.5">
              <div className={cn('w-2 h-2 rounded-full', orAvailable ? 'bg-green-500' : 'bg-red-500')} />
              <p className="text-lg font-bold truncate">{llm?.active.generation.provider ?? '—'}</p>
            </div>
            {orLatency != null && (
              <p className="text-xs text-muted-foreground mt-0.5 font-mono">{orLatency}ms{orCredits ? ` | ${orCredits}` : ''}</p>
            )}
          </div>
        </div>
      </div>

      {/* Service KPI Table */}
      <div className="bg-card border border-border rounded-lg overflow-hidden mb-8">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-semibold">Service KPI</h3>
        </div>
        <table className="w-full">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2">Category</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2">Metric</th>
              <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2">Value</th>
              <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            {kpiRows.map((row, i) => (
              <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/20">
                <td className="px-4 py-1.5 text-xs text-muted-foreground">{row.category}</td>
                <td className="px-4 py-1.5 text-sm">{row.metric}</td>
                <td className="px-4 py-1.5 text-sm text-right font-mono font-medium">
                  {row.metric === 'Status' ? (
                    <span className="inline-flex items-center gap-1">
                      <span className={cn('w-2 h-2 rounded-full inline-block', row.value === 'OK' ? 'bg-green-500' : 'bg-red-500')} />
                      {row.value}
                    </span>
                  ) : typeof row.value === 'number' ? (
                    row.value.toLocaleString()
                  ) : (
                    row.value
                  )}
                </td>
                <td className="px-4 py-1.5 text-xs text-muted-foreground font-mono">{row.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Daily Activity */}
      <div className="bg-card border border-border rounded-lg overflow-hidden mb-8">
        <div className="px-4 py-3 border-b border-border flex items-center gap-3 flex-wrap">
          <h3 className="text-sm font-semibold">Daily Activity</h3>
          <div className="flex gap-1 ml-auto">
            {(['today', '7d', '30d', 'custom'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setDatePreset(p)}
                className={cn(
                  'px-2.5 py-1 text-xs rounded-md border transition-colors',
                  datePreset === p
                    ? 'border-primary bg-primary/10 text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground'
                )}
              >
                {p === 'today' ? 'Today' : p === 'custom' ? 'Custom' : p.toUpperCase()}
              </button>
            ))}
          </div>
          {datePreset === 'custom' && (
            <div className="flex items-center gap-2 text-xs">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="px-2 py-1 rounded-md border border-border bg-background text-foreground text-xs"
              />
              <span className="text-muted-foreground">~</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="px-2 py-1 rounded-md border border-border bg-background text-foreground text-xs"
              />
            </div>
          )}
          <select
            value={selectedUserId}
            onChange={(e) => setSelectedUserId(e.target.value)}
            className="px-2 py-1 rounded-md border border-border bg-background text-foreground text-xs"
          >
            <option value="">All Users</option>
            {userList.map((u) => (
              <option key={u.id} value={u.id}>
                {maskEmail(u.email)}
              </option>
            ))}
          </select>
        </div>
        {activityLoading ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">Loading activity...</div>
        ) : activity.length === 0 ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">No activity data.</div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2">Date</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2">Logins</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2">Cards</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2">Notes</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2">AI Summary</th>
                <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2">Mandala</th>
              </tr>
            </thead>
            <tbody>
              {[...activity].reverse().map((row) => (
                <tr key={row.date} className="border-b border-border last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-1.5 text-sm font-mono text-muted-foreground">{row.date}</td>
                  <td className="px-4 py-1.5 text-sm text-right font-mono">{row.logins}</td>
                  <td className="px-4 py-1.5 text-sm text-right font-mono">{row.cardsCreated}</td>
                  <td className="px-4 py-1.5 text-sm text-right font-mono">{row.notesWritten}</td>
                  <td className="px-4 py-1.5 text-sm text-right font-mono">{row.aiSummaries}</td>
                  <td className="px-4 py-1.5 text-sm text-right font-mono">{row.mandalaActions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Tier Distribution */}
      <div className="bg-card border border-border rounded-lg p-4 mb-8">
        <h3 className="font-semibold mb-3">Tier Distribution</h3>
        <div className="flex gap-6">
          {stats.tiers.map((t) => (
            <div key={t.tier} className="text-center">
              <p className="text-xl font-bold">{t.count}</p>
              <p className="text-xs text-muted-foreground capitalize">{t.tier}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Signups */}
      {stats.recentSignups.length > 0 && (
        <div className="bg-card border border-border rounded-lg p-4">
          <h3 className="font-semibold mb-3">Recent Signups (Last 7 Days)</h3>
          <div className="space-y-1">
            {stats.recentSignups.map((d) => (
              <div key={d.date} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{d.date}</span>
                <span className="font-medium">{d.count}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
