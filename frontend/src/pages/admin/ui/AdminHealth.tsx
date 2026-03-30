import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { apiClient } from '@/shared/lib/api-client';
import {
  Activity,
  Database,
  Server,
  Bot,
  Check,
  Loader2,
  Sparkles,
  ChevronDown,
  Clock,
  AlertCircle,
  CheckCircle2,
  Play,
  Square,
  SkipForward,
} from 'lucide-react';
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
        {(['ollama', 'openrouter', 'gemini'] as const).map((p) => {
          const val = llm.health[p];
          const isUp = typeof val === 'object' && val !== null ? val.available : !!val;
          return (
            <div key={p} className="flex items-center gap-1.5 text-xs">
              <div className={cn('w-2 h-2 rounded-full', isUp ? 'bg-green-500' : 'bg-red-500')} />
              <span className="text-muted-foreground capitalize">{p}</span>
              {typeof val === 'object' && val !== null && val.latencyMs > 0 && (
                <span className="text-muted-foreground/60 font-mono">{val.latencyMs}ms</span>
              )}
            </div>
          );
        })}
      </div>

      {/* Provider Selection */}
      <div className="grid grid-cols-4 gap-2 mb-4">
        {PROVIDER_OPTIONS.map((opt) => {
          const isActive = currentProvider === opt.value;
          const healthVal = llm.health[opt.value as 'ollama' | 'openrouter' | 'gemini'];
          const isAvailable =
            opt.value === 'auto' ||
            (typeof healthVal === 'object' && healthVal !== null
              ? healthVal.available
              : !!healthVal);
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
            e.g. qwen/qwen3-30b-a3b, mistralai/mistral-small-3.1-24b-instruct,
            google/gemini-2.0-flash-001
          </p>
        </div>
      )}

      {/* Current Config Summary */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs text-muted-foreground mb-4">
        <div className="flex justify-between">
          <span>Embedding</span>
          <span className="font-mono">
            {llm.active.embedding.provider} ({llm.active.embedding.dimension}d)
          </span>
        </div>
        <div className="flex justify-between">
          <span>Generation</span>
          <span className="font-mono">{llm.active.generation.provider}</span>
        </div>
        <div className="flex justify-between">
          <span>Ollama URL</span>
          <span className="font-mono">{llm.config.ollama_url}</span>
        </div>
        <div className="flex justify-between">
          <span>Ollama Model</span>
          <span className="font-mono">{llm.config.ollama_generate_model}</span>
        </div>
      </div>

      {/* Save Button */}
      {hasChanges && (
        <button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className="flex items-center gap-2 px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {updateMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Check className="h-3.5 w-3.5" />
          )}
          Apply Provider Change
        </button>
      )}
      {updateMutation.isError && (
        <p className="text-xs text-red-400 mt-2">
          Failed to update: {(updateMutation.error as Error).message}
        </p>
      )}
    </div>
  );
}

// ============================================================================
// ClawbotCard
// ============================================================================

const CLAWBOT_POLL_RUNNING = 5_000;
const CLAWBOT_POLL_IDLE = 30_000;

type ClawbotRunStatus = 'running' | 'completed' | 'failed' | 'skipped';

function ClawbotRunIcon({ status }: { status: ClawbotRunStatus }) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />;
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />;
  if (status === 'skipped') return <SkipForward className="h-3.5 w-3.5 text-muted-foreground" />;
  return <AlertCircle className="h-3.5 w-3.5 text-red-400" />;
}

function ClawbotCard() {
  const queryClient = useQueryClient();
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data: statusData } = useQuery({
    queryKey: ['admin', 'clawbot', 'status'],
    queryFn: () => apiClient.getClawbotStatus(),
    refetchInterval: (query) => {
      const s = query.state.data?.data;
      return s?.running ? CLAWBOT_POLL_RUNNING : CLAWBOT_POLL_IDLE;
    },
    staleTime: 3_000,
  });

  const { data: historyData } = useQuery({
    queryKey: ['admin', 'clawbot', 'history'],
    queryFn: () => apiClient.getClawbotHistory(10),
    enabled: historyOpen,
    staleTime: 5_000,
  });

  const status = statusData?.data;
  const runs = historyData?.data?.runs ?? [];

  const triggerMutation = useMutation({
    mutationFn: () => apiClient.triggerClawbot(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'clawbot'] });
      toast.success('Clawbot run triggered');
    },
    onError: (err) => {
      toast.error(`Trigger failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    },
  });

  const startMutation = useMutation({
    mutationFn: () => apiClient.startClawbot(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'clawbot'] });
      toast.success('Clawbot started');
    },
    onError: (err) => {
      toast.error(`Start failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    },
  });

  const stopMutation = useMutation({
    mutationFn: () => apiClient.stopClawbot(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'clawbot'] });
      toast.success('Clawbot stopped');
    },
    onError: (err) => {
      toast.error(`Stop failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    },
  });

  if (!status) {
    return (
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Bot className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Clawbot Summary Agent</span>
        </div>
        <div className="text-xs text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const isToggling = startMutation.isPending || stopMutation.isPending;

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Bot className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Clawbot Summary Agent</span>
        <button
          onClick={() => (status.enabled ? stopMutation.mutate() : startMutation.mutate())}
          disabled={isToggling}
          className={cn(
            'ml-auto flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors',
            status.enabled
              ? 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
              : 'bg-green-500/10 text-green-400 hover:bg-green-500/20'
          )}
        >
          {isToggling ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : status.enabled ? (
            <>
              <Square className="h-3 w-3" /> Stop
            </>
          ) : (
            <>
              <Play className="h-3 w-3" /> Start
            </>
          )}
        </button>
      </div>

      {/* Status Row */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs text-muted-foreground mb-4">
        <div className="flex justify-between">
          <span>Status</span>
          <span className="flex items-center gap-1.5">
            <div
              className={cn(
                'w-2 h-2 rounded-full',
                status.enabled
                  ? status.running
                    ? 'bg-blue-500 animate-pulse'
                    : 'bg-green-500'
                  : 'bg-muted-foreground'
              )}
            />
            <span className="font-mono">
              {status.running ? 'Running' : status.enabled ? 'Idle' : 'Stopped'}
            </span>
          </span>
        </div>
        <div className="flex justify-between">
          <span>Schedule</span>
          <span className="font-mono">{status.config.cronExpression}</span>
        </div>
        <div className="flex justify-between">
          <span>Threshold</span>
          <span className="font-mono">{status.config.threshold}</span>
        </div>
        <div className="flex justify-between">
          <span>Batch Limit</span>
          <span className="font-mono">{status.config.batchLimit}</span>
        </div>
        <div className="flex justify-between">
          <span>Delay</span>
          <span className="font-mono">{status.config.delayMs / 1000}s</span>
        </div>
        <div className="flex justify-between">
          <span>Total Enriched</span>
          <span className="font-mono text-green-400">{status.stats.totalEnriched}</span>
        </div>
      </div>

      {/* Last Run Info */}
      {status.lastRun && (
        <div className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
          <ClawbotRunIcon status={status.lastRun.status} />
          <span>
            Last: {new Date(status.lastRun.startedAt).toLocaleString()} ({status.lastRun.trigger})
            {status.lastRun.result && (
              <span className="ml-1">
                — {status.lastRun.result.enriched}/{status.lastRun.unsummarizedCount} enriched
                {status.lastRun.result.errors.length > 0 && (
                  <span className="text-red-400 ml-1">
                    ({status.lastRun.result.errors.length} err)
                  </span>
                )}
              </span>
            )}
            {status.lastRun.status === 'skipped' && (
              <span className="ml-1">
                — {status.lastRun.unsummarizedCount} &lt; threshold {status.config.threshold}
              </span>
            )}
          </span>
        </div>
      )}

      {/* Current Run Progress */}
      {status.currentRun && status.currentRun.status === 'running' && (
        <div className="flex items-center gap-2 mb-3 text-xs text-blue-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Running... ({status.currentRun.unsummarizedCount} unsummarized found)</span>
        </div>
      )}

      {/* Run Now Button */}
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => triggerMutation.mutate()}
          disabled={triggerMutation.isPending || status.running || !status.enabled}
          className="flex items-center gap-2 px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {triggerMutation.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" />
          )}
          Run Now
        </button>
        {triggerMutation.isError && (
          <span className="text-xs text-red-400">{(triggerMutation.error as Error).message}</span>
        )}
      </div>

      {/* History (collapsible) */}
      <div className="border-t border-border/50 pt-3">
        <button
          onClick={() => setHistoryOpen(!historyOpen)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
        >
          <Clock className="h-3 w-3" />
          <span>History ({status.stats.totalRuns} runs)</span>
          <ChevronDown
            className={cn('h-3 w-3 ml-auto transition-transform', historyOpen && 'rotate-180')}
          />
        </button>

        {historyOpen && runs.length > 0 && (
          <div className="mt-2 space-y-1 max-h-[250px] overflow-y-auto scrollbar-thin">
            {runs.map((run) => (
              <div
                key={run.id}
                className="flex items-center gap-2 px-2.5 py-1.5 text-xs rounded border border-border/30 bg-muted/10"
              >
                <ClawbotRunIcon status={run.status} />
                <span className="font-mono text-muted-foreground">
                  {new Date(run.startedAt).toLocaleString()}
                </span>
                <span className="text-muted-foreground">{run.trigger}</span>
                {run.result && (
                  <span className="ml-auto text-muted-foreground">
                    {run.result.enriched}/{run.unsummarizedCount}
                    {run.result.errors.length > 0 && (
                      <span className="text-red-400 ml-1">({run.result.errors.length} err)</span>
                    )}
                  </span>
                )}
                {run.status === 'skipped' && (
                  <span className="ml-auto text-muted-foreground/60">skipped</span>
                )}
                {run.completedAt && run.startedAt && (
                  <span className="text-muted-foreground/60 ml-1">
                    {formatDuration(run.startedAt, run.completedAt)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// EnrichmentSchedulerCard
// ============================================================================

const SCHED_POLL_IDLE = 30_000;

function EnrichmentSchedulerCard() {
  const { data: statusData } = useQuery({
    queryKey: ['admin', 'enrichment-scheduler', 'status'],
    queryFn: () => apiClient.getEnrichSchedulerStatus(),
    refetchInterval: SCHED_POLL_IDLE,
    staleTime: 3_000,
  });

  const status = statusData?.data;

  if (!status) {
    return (
      <div className="bg-card border border-border rounded-lg p-4">
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Enrichment Scheduler</span>
        </div>
        <div className="text-xs text-muted-foreground">Loading...</div>
      </div>
    );
  }

  const healthColor = status.running ? 'bg-green-500' : 'bg-muted-foreground';

  const queues = status.queues ?? {};
  const queueNames = Object.keys(queues);

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Enrichment Scheduler</span>
        <span className="text-xs text-muted-foreground ml-1">({status.engine})</span>
        <span className="ml-auto flex items-center gap-1.5">
          <div className={cn('w-2 h-2 rounded-full', healthColor)} />
          <span className="text-xs font-mono text-muted-foreground">
            {status.running ? 'Running' : 'Stopped'}
          </span>
        </span>
      </div>

      {/* Queue Stats */}
      {queueNames.length > 0 ? (
        <div className="space-y-2">
          {queueNames.map((name) => {
            const q = queues[name];
            return (
              <div
                key={name}
                className="grid grid-cols-5 gap-2 text-xs text-muted-foreground border border-border/30 rounded p-2"
              >
                <span className="font-mono font-medium text-foreground col-span-1 truncate">
                  {name}
                </span>
                <span>
                  Created: <span className="font-mono">{q.created}</span>
                </span>
                <span>
                  Active: <span className="font-mono text-blue-400">{q.active}</span>
                </span>
                <span>
                  Done: <span className="font-mono text-green-400">{q.completed}</span>
                </span>
                <span>
                  Failed:{' '}
                  <span className={cn('font-mono', q.failed > 0 ? 'text-red-400' : '')}>
                    {q.failed}
                  </span>
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No queues registered</p>
      )}
    </div>
  );
}

// ============================================================================
// BatchEnrichCard
// ============================================================================

type EnrichJobStatus = 'running' | 'completed' | 'failed';

interface EnrichJobData {
  id: string;
  status: EnrichJobStatus;
  limit: number;
  startedAt: string;
  completedAt: string | null;
  result: {
    total: number;
    enriched: number;
    skipped: number;
    errors: { videoId: string; error: string }[];
  } | null;
  error: string | null;
}

const JOB_POLL_INTERVAL_MS = 5_000;

function formatDuration(start: string, end: string | null): string {
  const ms = (end ? new Date(end).getTime() : Date.now()) - new Date(start).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s`;
}

function JobStatusIcon({ status }: { status: EnrichJobStatus }) {
  if (status === 'running') return <Loader2 className="h-3.5 w-3.5 animate-spin text-blue-400" />;
  if (status === 'completed') return <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />;
  return <AlertCircle className="h-3.5 w-3.5 text-red-400" />;
}

function BatchEnrichCard() {
  const queryClient = useQueryClient();
  const [limit, setLimit] = useState(50);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);

  // Poll job history — auto-refresh while any job is running
  const { data: jobsData } = useQuery({
    queryKey: ['admin', 'enrichment', 'jobs'],
    queryFn: () => apiClient.getEnrichJobs(20),
    refetchInterval: (query) => {
      const jobs = query.state.data?.data?.jobs;
      const hasRunning = jobs?.some((j) => j.status === 'running');
      return hasRunning ? JOB_POLL_INTERVAL_MS : false;
    },
    staleTime: 3_000,
  });

  const jobsList: EnrichJobData[] = jobsData?.data?.jobs ?? [];
  const hasRunning = jobsList.some((j) => j.status === 'running');
  const latestJob = jobsList[0] ?? null;

  const mutation = useMutation({
    mutationFn: () => apiClient.runBatchEnrich({ limit, delay_ms: 3000 }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'enrichment', 'jobs'] });
    },
  });

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Batch AI Summary</span>
        <span className="text-xs text-muted-foreground ml-auto">
          Enrich YouTube cards without summaries
        </span>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-4">
        <label className="text-xs text-muted-foreground">Limit:</label>
        <input
          type="number"
          value={limit}
          onChange={(e) => setLimit(Math.max(1, Math.min(500, Number(e.target.value))))}
          className="w-20 px-2 py-1 rounded-md border border-border bg-background text-sm font-mono text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || hasRunning}
          className="flex items-center gap-2 px-4 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {hasRunning ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Running...
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" /> Run Batch
            </>
          )}
        </button>
      </div>

      {/* Latest job result */}
      {latestJob?.status === 'running' && (
        <div className="flex items-center gap-2 mb-3 text-xs text-blue-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Running... ({formatDuration(latestJob.startedAt, null)} elapsed)</span>
        </div>
      )}

      {latestJob?.result && latestJob.status === 'completed' && (
        <div className="grid grid-cols-3 gap-2 text-xs mb-3">
          <div className="bg-muted/30 rounded p-2 text-center">
            <div className="text-lg font-mono font-bold text-foreground">
              {latestJob.result.total}
            </div>
            <div className="text-muted-foreground">Found</div>
          </div>
          <div className="bg-green-500/10 rounded p-2 text-center">
            <div className="text-lg font-mono font-bold text-green-400">
              {latestJob.result.enriched}
            </div>
            <div className="text-muted-foreground">Enriched</div>
          </div>
          <div className="bg-red-500/10 rounded p-2 text-center">
            <div className="text-lg font-mono font-bold text-red-400">
              {latestJob.result.errors.length}
            </div>
            <div className="text-muted-foreground">Errors</div>
          </div>
        </div>
      )}

      {latestJob?.status === 'failed' && (
        <p className="text-xs text-red-400 mb-3">Failed: {latestJob.error}</p>
      )}

      {mutation.isError && (
        <p className="text-xs text-red-400 mb-3">{(mutation.error as Error).message}</p>
      )}

      {/* Job History (collapsible) */}
      {jobsList.length > 0 && (
        <div className="border-t border-border/50 pt-3">
          <button
            onClick={() => setHistoryOpen(!historyOpen)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            <Clock className="h-3 w-3" />
            <span>History ({jobsList.length})</span>
            <ChevronDown
              className={cn('h-3 w-3 ml-auto transition-transform', historyOpen && 'rotate-180')}
            />
          </button>

          {historyOpen && (
            <div className="mt-2 space-y-1 max-h-[300px] overflow-y-auto scrollbar-thin">
              {jobsList.map((job) => (
                <div key={job.id} className="rounded border border-border/30 bg-muted/10">
                  <button
                    onClick={() => setExpandedJobId(expandedJobId === job.id ? null : job.id)}
                    className="flex items-center gap-2 w-full px-2.5 py-1.5 text-xs hover:bg-muted/20 transition-colors"
                  >
                    <JobStatusIcon status={job.status} />
                    <span className="font-mono text-muted-foreground">
                      {new Date(job.startedAt).toLocaleString()}
                    </span>
                    <span className="text-muted-foreground">limit={job.limit}</span>
                    {job.result && (
                      <span className="ml-auto text-muted-foreground">
                        {job.result.enriched}/{job.result.total}
                        {job.result.errors.length > 0 && (
                          <span className="text-red-400 ml-1">
                            ({job.result.errors.length} err)
                          </span>
                        )}
                      </span>
                    )}
                    {job.status === 'running' && (
                      <span className="ml-auto text-blue-400">
                        {formatDuration(job.startedAt, null)}
                      </span>
                    )}
                    {job.completedAt && (
                      <span className="text-muted-foreground/60 ml-1">
                        {formatDuration(job.startedAt, job.completedAt)}
                      </span>
                    )}
                    <ChevronDown
                      className={cn(
                        'h-3 w-3 transition-transform',
                        expandedJobId === job.id && 'rotate-180'
                      )}
                    />
                  </button>

                  {expandedJobId === job.id && (
                    <div className="px-2.5 pb-2 text-xs space-y-1">
                      {job.error && <div className="text-red-400 font-mono">{job.error}</div>}
                      {job.result && (
                        <>
                          <div className="grid grid-cols-4 gap-1">
                            <div className="text-muted-foreground">
                              Total:{' '}
                              <span className="text-foreground font-mono">{job.result.total}</span>
                            </div>
                            <div className="text-muted-foreground">
                              Enriched:{' '}
                              <span className="text-green-400 font-mono">
                                {job.result.enriched}
                              </span>
                            </div>
                            <div className="text-muted-foreground">
                              Skipped:{' '}
                              <span className="text-foreground font-mono">
                                {job.result.skipped}
                              </span>
                            </div>
                            <div className="text-muted-foreground">
                              Errors:{' '}
                              <span className="text-red-400 font-mono">
                                {job.result.errors.length}
                              </span>
                            </div>
                          </div>
                          {job.result.errors.length > 0 && (
                            <div className="mt-1 space-y-0.5 max-h-24 overflow-y-auto text-red-400/80 font-mono">
                              {job.result.errors.map((e, i) => (
                                <div key={i}>
                                  {e.videoId}: {e.error}
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
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
                <span
                  className={cn(
                    'ml-auto px-2 py-0.5 rounded-full text-xs',
                    STATUS_STYLES[api?.status ?? 'down']
                  )}
                >
                  {api?.status ?? 'unknown'}
                </span>
              </div>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Uptime</span>
                  <span className="font-mono">{formatUptime(api?.uptime ?? 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Response</span>
                  <span className="font-mono">{api?.responseTimeMs ?? 0}ms</span>
                </div>
                <div className="flex justify-between">
                  <span>Heap Used</span>
                  <span className="font-mono">{api?.memory?.heapUsedMB ?? 0}MB</span>
                </div>
                <div className="flex justify-between">
                  <span>RSS</span>
                  <span className="font-mono">{api?.memory?.rssMB ?? 0}MB</span>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Database className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Database</span>
                <span
                  className={cn(
                    'ml-auto px-2 py-0.5 rounded-full text-xs',
                    STATUS_STYLES[database?.status ?? 'down']
                  )}
                >
                  {database?.status ?? 'unknown'}
                </span>
              </div>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Latency</span>
                  <span className="font-mono">{database?.latencyMs ?? 0}ms</span>
                </div>
                <div className="flex justify-between">
                  <span>Active Conn</span>
                  <span className="font-mono">{database?.activeConnections ?? 0}</span>
                </div>
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-3">
                <Activity className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">Environment</span>
              </div>
              <div className="space-y-1.5 text-xs text-muted-foreground">
                <div className="flex justify-between">
                  <span>Node</span>
                  <span className="font-mono">{env?.nodeVersion ?? '—'}</span>
                </div>
                <div className="flex justify-between">
                  <span>Platform</span>
                  <span className="font-mono">{env?.platform ?? '—'}</span>
                </div>
              </div>
            </div>
          </div>

          {/* LLM Settings */}
          <LlmSettingsCard />

          {/* Enrichment Scheduler (adaptive, replaces Clawbot) */}
          <EnrichmentSchedulerCard />

          {/* Clawbot Summary Agent (legacy) */}
          <ClawbotCard />

          {/* Batch Enrichment (manual) */}
          <BatchEnrichCard />

          {/* Table Sizes */}
          <div className="bg-card border border-border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-medium">Table Row Counts</h2>
            </div>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2">
                    Table
                  </th>
                  <th className="text-right text-xs font-medium text-muted-foreground px-4 py-2">
                    Rows
                  </th>
                </tr>
              </thead>
              <tbody>
                {(database?.tableSizes ?? []).map((t: Record<string, unknown>) => (
                  <tr
                    key={t['table_name'] as string}
                    className="border-b border-border last:border-0 hover:bg-muted/20"
                  >
                    <td className="px-4 py-2 text-sm font-mono">{t['table_name'] as string}</td>
                    <td className="px-4 py-2 text-sm text-right font-mono">
                      {String(t['row_count'] ?? 0)}
                    </td>
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
