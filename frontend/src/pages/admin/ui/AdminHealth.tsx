import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/shared/lib/api-client';
import { Activity, Database, Server, Bot, Check, Loader2 } from 'lucide-react';
import { cn } from '@/shared/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  healthy: 'bg-green-500/20 text-green-400',
  degraded: 'bg-yellow-500/20 text-yellow-400',
  down: 'bg-red-500/20 text-red-400',
};

const PROVIDER_OPTIONS = [
  { value: 'auto', label: 'Auto', desc: 'Ollama → OpenRouter → Gemini' },
  { value: 'openrouter', label: 'OpenRouter', desc: 'Cloud LLM via OpenRouter API' },
  { value: 'ollama', label: 'Ollama', desc: 'Local inference (requires GPU)' },
  { value: 'gemini', label: 'Gemini', desc: 'Google Gemini API' },
] as const;

function LlmSettingsCard() {
  const queryClient = useQueryClient();
  const { data: llmData, isLoading } = useQuery({
    queryKey: ['admin', 'llm'],
    queryFn: () => apiClient.getAdminLlm(),
    staleTime: 10_000,
  });

  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [modelInput, setModelInput] = useState('');

  const llm = llmData?.data;
  const currentProvider = selectedProvider ?? llm?.config.provider ?? 'auto';

  const updateMutation = useMutation({
    mutationFn: (body: { provider: string; openrouter_model?: string }) =>
      apiClient.updateAdminLlm(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'llm'] });
      setSelectedProvider(null);
      setModelInput('');
    },
  });

  const handleSave = () => {
    const body: { provider: string; openrouter_model?: string } = { provider: currentProvider };
    if (currentProvider === 'openrouter' && modelInput.trim()) {
      body.openrouter_model = modelInput.trim();
    }
    updateMutation.mutate(body);
  };

  const hasChanges = selectedProvider !== null && selectedProvider !== llm?.config.provider;

  if (isLoading) {
    return (
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">LLM Provider</span>
        </div>
        <div className="text-xs text-muted-foreground">Loading...</div>
      </div>
    );
  }

  if (!llm) return null;

  return (
    <div className="bg-card border border-border rounded-lg p-4 col-span-3">
      <div className="flex items-center gap-2 mb-4">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">LLM Provider Settings</span>
        <span className="ml-auto text-xs text-muted-foreground">
          Active: {llm.active.generation.provider} ({llm.active.generation.model})
        </span>
      </div>

      {/* Provider Health Indicators */}
      <div className="flex gap-3 mb-4">
        {(['ollama', 'openrouter', 'gemini'] as const).map((p) => (
          <div key={p} className="flex items-center gap-1.5 text-xs">
            <div className={cn('w-2 h-2 rounded-full', llm.health[p] ? 'bg-green-500' : 'bg-red-500')} />
            <span className="text-muted-foreground capitalize">{p}</span>
          </div>
        ))}
      </div>

      {/* Provider Selection */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {PROVIDER_OPTIONS.map((opt) => {
          const isActive = currentProvider === opt.value;
          const isAvailable = opt.value === 'auto' || llm.health[opt.value as 'ollama' | 'openrouter' | 'gemini'];
          return (
            <button
              key={opt.value}
              onClick={() => setSelectedProvider(opt.value)}
              disabled={!isAvailable}
              className={cn(
                'flex flex-col items-start gap-1 p-3 rounded-md border text-left transition-colors',
                isActive
                  ? 'border-primary bg-primary/10 text-foreground'
                  : isAvailable
                    ? 'border-border hover:border-muted-foreground/50 text-muted-foreground hover:text-foreground'
                    : 'border-border/50 text-muted-foreground/50 cursor-not-allowed'
              )}
            >
              <div className="flex items-center gap-1.5 w-full">
                <span className="text-sm font-medium">{opt.label}</span>
                {llm.config.provider === opt.value && (
                  <Check className="h-3 w-3 text-green-500 ml-auto" />
                )}
              </div>
              <span className="text-[10px] leading-tight">{opt.desc}</span>
            </button>
          );
        })}
      </div>

      {/* OpenRouter Model Override */}
      {currentProvider === 'openrouter' && (
        <div className="mb-4">
          <label className="block text-xs text-muted-foreground mb-1">OpenRouter Model</label>
          <input
            type="text"
            value={modelInput || llm.config.openrouter_model}
            onChange={(e) => setModelInput(e.target.value)}
            placeholder={llm.config.openrouter_model}
            className="w-full px-3 py-1.5 rounded-md border border-border bg-background text-sm font-mono text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            e.g. qwen/qwen3-30b-a3b, mistralai/mistral-small-3.1-24b-instruct, google/gemini-2.0-flash-001
          </p>
        </div>
      )}

      {/* Current Config Summary */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-muted-foreground mb-4">
        <div className="flex justify-between"><span>Embedding</span><span className="font-mono">{llm.active.embedding.provider} ({llm.active.embedding.dimension}d)</span></div>
        <div className="flex justify-between"><span>Generation</span><span className="font-mono">{llm.active.generation.provider}</span></div>
        <div className="flex justify-between"><span>Ollama URL</span><span className="font-mono">{llm.config.ollama_url}</span></div>
        <div className="flex justify-between"><span>Ollama Model</span><span className="font-mono">{llm.config.ollama_generate_model}</span></div>
      </div>

      {/* Save Button */}
      {hasChanges && (
        <button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className="flex items-center gap-2 px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Apply Provider Change
        </button>
      )}
      {updateMutation.isError && (
        <p className="text-xs text-red-400 mt-2">Failed to update: {(updateMutation.error as Error).message}</p>
      )}
    </div>
  );
}

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
            <div className="bg-card border border-border rounded-lg p-4">
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

            <div className="bg-card border border-border rounded-lg p-4">
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

            <div className="bg-card border border-border rounded-lg p-4">
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

          {/* LLM Settings */}
          <LlmSettingsCard />

          {/* Table Sizes */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
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
