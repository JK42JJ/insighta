import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { Activity, Database, Server } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  healthy: 'bg-green-500/20 text-green-400',
  degraded: 'bg-yellow-500/20 text-yellow-400',
  down: 'bg-red-500/20 text-red-400',
};

export function AdminHealth() {
  const { data, isLoading, dataUpdatedAt } = useQuery({
    queryKey: ['admin', 'health'],
    queryFn: () => apiClient.getAdminHealth(),
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const health = data?.data;
  const api = health?.api;
  const database = health?.database;
  const env = health?.environment;

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  return (
    <div className="p-6 max-w-6xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">System Health</h1>
        <span className="text-xs text-muted-foreground">
          Last updated: {dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString() : '—'}
        </span>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading health data...</div>
      ) : !health ? (
        <div className="text-center py-12 text-red-400">Failed to load health data.</div>
      ) : (
        <>
          {/* Status Cards */}
          <div className="grid grid-cols-3 gap-4">
            <div className="admin-glass p-4">
              <div className="flex items-center gap-2 mb-3">
                <Server className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">API Server</span>
                <span className={cn('ml-auto px-2 py-0.5 rounded-full text-xs', STATUS_STYLES[api?.status ?? 'down'])}>
                  {api?.status ?? 'unknown'}
                </span>
              </div>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <div className="flex justify-between"><span>Uptime</span><span className="font-mono">{formatUptime(api?.uptime ?? 0)}</span></div>
                <div className="flex justify-between"><span>Response</span><span className="font-mono">{api?.responseTimeMs ?? 0}ms</span></div>
                <div className="flex justify-between"><span>Heap Used</span><span className="font-mono">{api?.memory?.heapUsedMB ?? 0}MB</span></div>
                <div className="flex justify-between"><span>RSS</span><span className="font-mono">{api?.memory?.rssMB ?? 0}MB</span></div>
              </div>
            </div>

            <div className="admin-glass p-4">
              <div className="flex items-center gap-2 mb-3">
                <Database className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Database</span>
                <span className={cn('ml-auto px-2 py-0.5 rounded-full text-xs', STATUS_STYLES[database?.status ?? 'down'])}>
                  {database?.status ?? 'unknown'}
                </span>
              </div>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <div className="flex justify-between"><span>Latency</span><span className="font-mono">{database?.latencyMs ?? 0}ms</span></div>
                <div className="flex justify-between"><span>Active Conn</span><span className="font-mono">{database?.activeConnections ?? 0}</span></div>
              </div>
            </div>

            <div className="admin-glass p-4">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Environment</span>
              </div>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <div className="flex justify-between"><span>Node</span><span className="font-mono">{env?.nodeVersion ?? '—'}</span></div>
                <div className="flex justify-between"><span>Platform</span><span className="font-mono">{env?.platform ?? '—'}</span></div>
              </div>
            </div>
          </div>

          {/* Table Sizes */}
          <div className="admin-glass overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-medium">Table Row Counts</h2>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2">Table</th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2">Rows</th>
                </tr>
              </thead>
              <tbody>
                {(database?.tableSizes ?? []).map((t: Record<string, unknown>) => (
                  <tr key={t['table_name'] as string} className="border-b border-border last:border-0 hover:bg-muted/20">
                    <td className="px-4 py-2 text-sm font-mono">{t['table_name'] as string}</td>
                    <td className="px-4 py-2 text-sm text-right font-mono">{String(t['row_count'] ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
