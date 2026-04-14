import { useState, useCallback } from 'react';
import { trackSkillActivated } from '@/shared/lib/posthog';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronRight,
  Mail,
  FileText,
  Bell,
  Sparkles,
  Loader2,
  Copy,
  Download,
  X,
  History,
  Video,
  PenLine,
  Lock,
  TrendingUp,
  Search,
} from 'lucide-react';
import { useSkillList, useSkillPreview, useSkillExecute, useSkillOutputs } from '@/features/skill';
import { useToast } from '@/shared/lib/use-toast';
import { apiClient, type SkillOutputResponse } from '@/shared/lib/api-client';
import { cn } from '@/shared/lib/utils';

// ─── Dashboard skill state hook (cache-shared with useDashboard via identical queryKey) ───
//
// Uses the SAME queryKey + staleTime as features/mandala-dashboard/model/useDashboard.ts
// so React Query dedupes the underlying network call. We only use `select` to extract the
// `skills` field — the cached object is the full DashboardApiResponse and remains shared.
//
// Phase 4: PRO list is empty. The badge component supports the PRO state for future use.
const PRO_SKILL_TYPES: ReadonlySet<string> = new Set();
const DASHBOARD_STALE_TIME_MS = 5 * 60 * 1000;

interface DashboardApiResponseShape {
  skills?: Record<string, boolean>;
}

async function fetchDashboardForSkills(mandalaId: string): Promise<DashboardApiResponseShape> {
  await apiClient.tokenReady;
  const token = apiClient.getAccessToken();
  // Reach baseUrl the same way useDashboard.ts does (private field access pattern).
  const baseUrl = (apiClient as unknown as { baseUrl: string }).baseUrl;
  const url = `${baseUrl}/api/v1/mandalas/${mandalaId}/dashboard`;
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) {
    throw new Error(`Dashboard API error: ${response.status}`);
  }
  return response.json() as Promise<DashboardApiResponseShape>;
}

function useDashboardSkills(mandalaId: string | null): Record<string, boolean> {
  const { data } = useQuery({
    queryKey: ['mandala', 'dashboard', mandalaId],
    queryFn: () => fetchDashboardForSkills(mandalaId as string),
    enabled: !!mandalaId,
    staleTime: DASHBOARD_STALE_TIME_MS,
    select: (d: DashboardApiResponseShape) => d.skills ?? {},
  });
  return data ?? {};
}

// ─── Icon mapping ───

const SKILL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  newsletter: Mail,
  report: FileText,
  alert: Bell,
  recommend: Sparkles,
  script: Video,
  blog: PenLine,
  video_discover: Video,
};

// ─── Color theme per skill (gradient bg + stroke color) ───

interface SkillColor {
  /** Tailwind-compatible gradient bg for the icon circle */
  iconBg: string;
  /** SVG stroke color */
  stroke: string;
}

const SKILL_COLORS: Record<string, SkillColor> = {
  newsletter: {
    iconBg: 'linear-gradient(145deg, rgba(129,140,248,0.2), rgba(129,140,248,0.06))',
    stroke: '#818cf8',
  },
  report: {
    iconBg: 'linear-gradient(145deg, rgba(52,211,153,0.2), rgba(52,211,153,0.06))',
    stroke: '#34d399',
  },
  alert: {
    iconBg: 'linear-gradient(145deg, rgba(251,113,133,0.2), rgba(251,113,133,0.06))',
    stroke: '#fb7185',
  },
  recommend: {
    iconBg: 'linear-gradient(145deg, rgba(167,139,250,0.2), rgba(167,139,250,0.06))',
    stroke: '#a78bfa',
  },
  script: {
    iconBg: 'linear-gradient(145deg, rgba(56,189,248,0.2), rgba(56,189,248,0.06))',
    stroke: '#38bdf8',
  },
  blog: {
    iconBg: 'linear-gradient(145deg, rgba(251,146,60,0.2), rgba(251,146,60,0.06))',
    stroke: '#fb923c',
  },
};

const OFF_ICON_BG = 'rgba(255,255,255,0.025)';
const PRO_ICON_BG = 'rgba(255,255,255,0.02)';

const SKILL_DESC_KEYS: Record<string, string> = {
  newsletter: 'descNewsletter',
  report: 'descReport',
  alert: 'descAlert',
  recommend: 'descRecommend',
  script: 'descScript',
  blog: 'descBlog',
  video_discover: 'descVideoDiscover',
};

/**
 * Short user-facing labels (Korean / English via i18n).
 * Long English descriptions clutter the sidebar — see CP356 fix #3.
 */
const SKILL_SHORT_LABEL_KEYS: Record<string, string> = {
  recommend: 'shortRecommend',
  newsletter: 'shortNewsletter',
  alert: 'shortAlert',
  report: 'shortReport',
  script: 'shortScript',
  blog: 'shortBlog',
};

// SSOT import — keeps wizard + sidebar synced. Adding/removing a user-visible
// skill happens in shared/types/mandala-ux.ts only.
import {
  USER_VISIBLE_SKILL_TYPES as USER_VISIBLE_SKILL_TYPES_ARRAY,
  LINKED_SKILL_TOGGLES,
} from '@/shared/types/mandala-ux';

const USER_VISIBLE_SKILL_TYPES: ReadonlySet<string> = new Set(USER_VISIBLE_SKILL_TYPES_ARRAY);

/**
 * UI-only PRO skill entries (no backend SkillId yet). Shown below the
 * free-tier divider with a Lock icon + PRO badge. Click → upgrade toast.
 * When a real backend skill is added, move the id into USER_VISIBLE_SKILL_TYPES
 * and remove the entry here.
 */
interface ExtraProSkill {
  id: string;
  shortLabelKey: string;
  defaultLabel: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number | string }>;
}
const EXTRA_PRO_SKILLS: ReadonlyArray<ExtraProSkill> = [
  {
    id: 'pro-trend-analysis',
    shortLabelKey: 'shortProTrend',
    defaultLabel: '트렌드 분석',
    icon: TrendingUp,
  },
  {
    id: 'pro-auto-research',
    shortLabelKey: 'shortProAutoResearch',
    defaultLabel: '자동 리서치',
    icon: Search,
  },
];

/**
 * CP356 fix #4: hide preview/execute/output history rendering in the sidebar.
 * Logic + hooks remain so they can move to a dedicated Settings page later.
 * Set to true to restore the inline panels.
 */
const ENABLE_INLINE_SKILL_PANELS = false;

const SKILL_TYPE_KEYS: Record<string, string> = {
  newsletter: 'typeNewsletter',
  report: 'typeReport',
  alert: 'typeAlert',
  recommend: 'typeRecommend',
  script: 'typeScript',
  blog: 'typeBlog',
  video_discover: 'typeVideoDiscover',
};

interface SkillPreviewData {
  skillId: string;
  subject?: string;
  preview_html?: string;
  curated_count?: number;
}

interface SkillOutputData {
  title: string;
  content: string;
  card_count?: number;
  sectors_covered?: number;
}

interface SidebarSkillPanelProps {
  mandalaId: string | null;
}

export function SidebarSkillPanel({ mandalaId }: SidebarSkillPanelProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('sidebar-skills-collapsed') === 'true';
  });
  const [showAll, setShowAll] = useState(false);
  const [previewData, setPreviewData] = useState<SkillPreviewData | null>(null);
  const [outputData, setOutputData] = useState<SkillOutputData | null>(null);
  const [expandedOutputId, setExpandedOutputId] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const { data: skillsResponse, isLoading } = useSkillList();
  const previewMutation = useSkillPreview();
  const executeMutation = useSkillExecute();
  const { data: outputsResponse } = useSkillOutputs(mandalaId);
  const skillEnabledMap = useDashboardSkills(mandalaId);
  const [togglingSkillId, setTogglingSkillId] = useState<string | null>(null);

  const skills = (skillsResponse?.data ?? []).filter((s) => USER_VISIBLE_SKILL_TYPES.has(s.id));

  const handleToggleSkill = useCallback(
    async (skillId: string) => {
      if (!mandalaId) return;
      const currentEnabled = skillEnabledMap[skillId] ?? false;
      const nextEnabled = !currentEnabled;
      setTogglingSkillId(skillId);

      // Optimistic update — immediately reflect toggle in UI
      const dashboardKey = ['mandala', 'dashboard', mandalaId];
      const previousData = queryClient.getQueryData<DashboardApiResponseShape>(dashboardKey);
      const linked = LINKED_SKILL_TOGGLES[skillId] ?? [];
      const allKeys = [skillId, ...linked];
      queryClient.setQueryData<DashboardApiResponseShape>(dashboardKey, (old) => {
        if (!old) return old;
        const updatedSkills = { ...(old.skills ?? {}) };
        for (const key of allKeys) {
          updatedSkills[key] = nextEnabled;
        }
        return { ...old, skills: updatedSkills };
      });

      try {
        await apiClient.tokenReady;
        const token = apiClient.getAccessToken();
        const baseUrl = (apiClient as unknown as { baseUrl: string }).baseUrl;

        // CP358 SSOT: linked toggles. e.g. recommend → also flip video_discover
        // so the BE pipeline lights up alongside the user-visible toggle.
        const patchOne = (skillType: string) =>
          fetch(`${baseUrl}/api/v1/mandalas/${mandalaId}/skills`, {
            method: 'PATCH',
            headers: {
              'Content-Type': 'application/json',
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ skillType, enabled: nextEnabled }),
          }).then((res) => {
            if (!res.ok) throw new Error(`Skill toggle failed (${skillType}): ${res.status}`);
          });
        await Promise.all(allKeys.map(patchOne));

        if (nextEnabled) {
          trackSkillActivated({ mandala_id: mandalaId, skill_type: skillId });
        }

        // Invalidate the cache key shared with useDashboard so the badge re-renders.
        await queryClient.invalidateQueries({
          queryKey: ['mandala', 'dashboard', mandalaId],
        });
      } catch (err) {
        // Rollback optimistic update on error
        if (previousData) {
          queryClient.setQueryData(dashboardKey, previousData);
        }
        const message = err instanceof Error ? err.message : undefined;
        toast({
          title: t('skills.toggleFailed', 'Toggle failed'),
          description: message,
          variant: 'destructive',
        });
      } finally {
        setTogglingSkillId(null);
      }
    },
    [mandalaId, skillEnabledMap, queryClient, toast, t]
  );

  const handleProClick = useCallback(() => {
    toast({
      title: t('skills.proLockedTitle', 'PRO 기능입니다'),
      description: t(
        'skills.proLockedDesc',
        '이 스킬은 PRO 플랜에서 곧 제공됩니다. 업그레이드 안내는 추후 출시 예정이에요.'
      ),
    });
  }, [toast, t]);

  const toggleCollapse = () => {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sidebar-skills-collapsed', String(next));
  };

  const handlePreview = async (skillId: string) => {
    if (!mandalaId) return;
    setOutputData(null);
    try {
      const result = await previewMutation.mutateAsync({ skillId, mandalaId });
      setPreviewData({ skillId, ...result.data });
    } catch {
      toast({ title: t('skills.previewFailed'), variant: 'destructive' });
    }
  };

  const handleExecute = async (skillId: string) => {
    if (!mandalaId) return;
    try {
      const result = await executeMutation.mutateAsync({ skillId, mandalaId });
      if (result.data.success && result.data.data) {
        const data = result.data.data as Record<string, unknown>;
        if (data.content) {
          setOutputData({
            title: (data.title as string) ?? t('skills.output'),
            content: data.content as string,
            card_count: data.card_count as number | undefined,
            sectors_covered: data.sectors_covered as number | undefined,
          });
        }
        toast({ title: t('skills.success') });
      } else if (result.data.data?.skipped) {
        toast({
          title: t('skills.noContent', 'No content available'),
          description: t('skills.noContentDesc', 'Add more cards to your mandala first.'),
        });
      } else {
        toast({
          title: t('skills.error'),
          description: result.data.error,
          variant: 'destructive',
        });
      }
      setPreviewData(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : undefined;
      toast({ title: t('skills.error'), description: message, variant: 'destructive' });
    }
  };

  const handleCopyOutput = useCallback(() => {
    if (!outputData) return;
    navigator.clipboard.writeText(outputData.content);
    toast({ title: t('common.copied', 'Copied to clipboard') });
  }, [outputData, toast, t]);

  const handleDownloadOutput = useCallback(() => {
    if (!outputData) return;
    const blob = new Blob([outputData.content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${outputData.title.replace(/[^a-zA-Z0-9가-힣]/g, '_')}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [outputData]);

  if (!mandalaId) return null;

  // Active skill count for header
  const activeCount = skills.filter((s) => skillEnabledMap[s.id]).length;
  const totalCount = skills.length + EXTRA_PRO_SKILLS.length;

  return (
    <div className="px-2">
      {/* Section header */}
      <button
        onClick={toggleCollapse}
        className="flex items-center gap-1 w-full text-left py-1 px-1"
      >
        {collapsed ? (
          <ChevronRight className="w-3 h-3 text-sidebar-foreground/40" />
        ) : (
          <ChevronDown className="w-3 h-3 text-sidebar-foreground/40" />
        )}
        <span className="text-xs font-bold text-sidebar-foreground/60">{t('skills.title')}</span>
        <span className="ml-auto text-[10px] text-sidebar-foreground/30 font-mono">
          {activeCount}/{totalCount} {t('skills.active', '활성')}
        </span>
      </button>

      {!collapsed && (
        <div className="mt-2">
          {isLoading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-4 h-4 animate-spin text-sidebar-foreground/40" />
            </div>
          )}

          {!isLoading && skills.length === 0 && (
            <p className="text-xs text-sidebar-foreground/40 px-1 py-2">{t('skills.empty')}</p>
          )}

          {/* Skill output result panel — hidden in CP356 (logic preserved). */}
          {ENABLE_INLINE_SKILL_PANELS && outputData && (
            <div className="mx-1 mb-2 p-2 rounded bg-sidebar-accent/50 text-xs space-y-2 border border-sidebar-border/50">
              <div className="flex items-center justify-between">
                <p className="font-medium text-sm">{outputData.title}</p>
                <button
                  onClick={() => setOutputData(null)}
                  className="text-sidebar-foreground/40 hover:text-sidebar-foreground/80"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {(outputData.card_count || outputData.sectors_covered) && (
                <p className="text-sidebar-foreground/60">
                  {outputData.card_count && `${outputData.card_count} cards`}
                  {outputData.card_count && outputData.sectors_covered && ' · '}
                  {outputData.sectors_covered && `${outputData.sectors_covered} sectors`}
                </p>
              )}
              <div className="max-h-60 overflow-y-auto prose prose-xs prose-invert whitespace-pre-wrap break-words">
                {outputData.content}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={handleCopyOutput}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-sidebar-accent"
                >
                  <Copy className="w-3 h-3" />
                  {t('common.copy', 'Copy')}
                </button>
                <button
                  onClick={handleDownloadOutput}
                  className="flex items-center gap-1 px-2 py-1 rounded text-xs hover:bg-sidebar-accent"
                >
                  <Download className="w-3 h-3" />
                  {t('common.download', 'Download')}
                </button>
              </div>
            </div>
          )}

          {/* ─── Skill icon grid ─── */}
          <div
            className="grid gap-y-1 max-h-[320px] overflow-y-auto scrollbar-thin"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))' }}
          >
            {(showAll ? skills : skills.slice(0, 6)).map((skill) => {
              const Icon = SKILL_ICONS[skill.id] ?? Sparkles;
              const isEnabled = skillEnabledMap[skill.id] ?? false;
              const isToggling = togglingSkillId === skill.id;
              const color = SKILL_COLORS[skill.id];

              return (
                <button
                  key={skill.id}
                  type="button"
                  onClick={() => handleToggleSkill(skill.id)}
                  disabled={isToggling}
                  className={cn(
                    'flex flex-col items-center py-3 px-1 rounded-xl cursor-pointer select-none',
                    'transition-all duration-200',
                    'hover:bg-[rgba(255,255,255,0.025)] active:scale-[0.96]',
                    isToggling && 'opacity-50 pointer-events-none'
                  )}
                >
                  {/* Icon circle */}
                  <div
                    className="relative flex items-center justify-center w-12 h-12 rounded-[14px] mb-[7px] transition-all duration-300"
                    style={{
                      background: isEnabled ? (color?.iconBg ?? OFF_ICON_BG) : OFF_ICON_BG,
                    }}
                  >
                    {/* Glow dot (ON only) — toned down */}
                    {isEnabled && (
                      <span
                        className="absolute -top-px -right-px w-[3px] h-[3px] rounded-full"
                        style={{
                          background: '#16a34a',
                          boxShadow: '0 0 3px rgba(22,163,74,0.3)',
                        }}
                      />
                    )}
                    {isToggling ? (
                      <Loader2
                        className="w-6 h-6 animate-spin text-sidebar-foreground/40"
                        strokeWidth={1.5}
                      />
                    ) : (
                      <span
                        className="transition-all duration-300"
                        style={{
                          color: isEnabled ? (color?.stroke ?? '#9394a0') : '#3a3b46',
                          opacity: isEnabled ? 0.85 : 0.35,
                        }}
                      >
                        <Icon className="w-6 h-6" strokeWidth={1.5} />
                      </span>
                    )}
                  </div>

                  {/* Label */}
                  <span
                    className={cn(
                      'text-[10px] font-medium text-center tracking-tight transition-colors duration-300 antialiased',
                      isEnabled ? 'text-[#9ea0a8]' : 'text-[#4e4f5c]'
                    )}
                  >
                    {t(
                      `skills.${SKILL_SHORT_LABEL_KEYS[skill.id] ?? SKILL_DESC_KEYS[skill.id] ?? skill.id}`,
                      skill.description
                    )}
                  </span>

                  {/* Activity feedback (placeholder — Phase 2 real data) */}
                  <span
                    className={cn(
                      "text-[9px] mt-0.5 font-['JetBrains_Mono',monospace] text-[#5a5b68] transition-opacity duration-300",
                      isEnabled ? 'opacity-100' : 'opacity-0'
                    )}
                  >
                    {/* Phase 2: real activity data from skill_execution_log */}
                    &nbsp;
                  </span>
                </button>
              );
            })}
          </div>

          {/* Show more toggle */}
          {skills.length > 6 && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="w-full text-center text-[9px] font-medium text-sidebar-foreground/40 hover:text-sidebar-foreground/60 py-1 transition-colors"
            >
              {showAll
                ? t('skills.showLess', '접기')
                : t('skills.showMore', `+${skills.length - 6}개 더보기`)}
            </button>
          )}

          {/* Free / PRO divider */}
          {EXTRA_PRO_SKILLS.length > 0 && skills.length > 0 && (
            <div className="my-1 h-px bg-[rgba(255,255,255,0.03)]" aria-hidden="true" />
          )}

          {/* PRO skills (UI-only) */}
          <div
            className="grid gap-y-1"
            style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(80px, 1fr))' }}
          >
            {EXTRA_PRO_SKILLS.map((proSkill) => {
              const ProIcon = proSkill.icon;
              return (
                <button
                  key={proSkill.id}
                  type="button"
                  onClick={handleProClick}
                  className={cn(
                    'relative flex flex-col items-center py-3 px-1 rounded-xl cursor-pointer select-none',
                    'transition-all duration-200',
                    'hover:bg-[rgba(255,255,255,0.025)] active:scale-[0.96]'
                  )}
                >
                  {/* PRO badge */}
                  <span
                    className="absolute top-2 right-3 text-[7px] font-extrabold tracking-wider px-1 py-px rounded-[3px]"
                    style={{
                      background: 'rgba(251,191,36,0.1)',
                      color: '#fbbf24',
                    }}
                  >
                    PRO
                  </span>

                  {/* Icon circle — dashed border */}
                  <div
                    className="flex items-center justify-center w-12 h-12 rounded-[14px] mb-[7px]"
                    style={{
                      background: PRO_ICON_BG,
                      border: '1px dashed rgba(251,191,36,0.15)',
                    }}
                  >
                    <ProIcon className="w-6 h-6 text-[#3a3b46] opacity-25" strokeWidth={1.5} />
                  </div>

                  {/* Label */}
                  <span className="text-[11px] font-semibold text-[#3a3b46] text-center">
                    {t(`skills.${proSkill.shortLabelKey}`, proSkill.defaultLabel)}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Outputs history — hidden in CP356 (logic preserved). */}
          {ENABLE_INLINE_SKILL_PANELS && (
            <SkillOutputHistory
              outputs={outputsResponse?.data ?? []}
              expandedId={expandedOutputId}
              onToggle={setExpandedOutputId}
              onCopy={(content) => {
                navigator.clipboard.writeText(content);
                toast({ title: t('common.copied', 'Copied to clipboard') });
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkillOutputHistory — collapsible list of past outputs
// ---------------------------------------------------------------------------

// Skill type labels are now in i18n: skills.typeNewsletter, skills.typeReport, etc.

function formatRelativeDate(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function SkillOutputHistory({
  outputs,
  expandedId,
  onToggle,
  onCopy,
}: {
  outputs: SkillOutputResponse[];
  expandedId: string | null;
  onToggle: (id: string | null) => void;
  onCopy: (content: string) => void;
}) {
  const { t } = useTranslation();

  if (outputs.length === 0) return null;

  return (
    <div className="mt-3 pt-2 border-t border-sidebar-border/30">
      <div className="flex items-center gap-1 px-1 mb-1">
        <History className="w-3 h-3 text-sidebar-foreground/60" />
        <span className="text-xs font-medium text-sidebar-foreground/60">
          {t('skills.history')}
        </span>
      </div>
      <div className="space-y-0.5">
        {outputs.map((output) => {
          const isExpanded = expandedId === output.id;
          const Icon = SKILL_ICONS[output.skill_type] ?? Sparkles;

          return (
            <div key={output.id}>
              <button
                onClick={() => onToggle(isExpanded ? null : output.id)}
                className="flex items-center gap-2 w-full text-left text-xs px-2 py-1 rounded-md hover:bg-sidebar-accent transition-colors"
              >
                <Icon className="w-3 h-3 shrink-0 text-sidebar-foreground/40" />
                <span className="truncate flex-1">{output.title}</span>
                <span className="text-[10px] text-sidebar-foreground/40 shrink-0">
                  {formatRelativeDate(output.created_at)}
                </span>
              </button>
              {isExpanded && (
                <div className="mx-1 mt-1 mb-2 p-2 rounded bg-sidebar-accent/50 text-xs space-y-2 border border-sidebar-border/50">
                  <div className="flex items-center justify-between">
                    <span className="text-sidebar-foreground/60">
                      {t(
                        `skills.${SKILL_TYPE_KEYS[output.skill_type] ?? output.skill_type}`,
                        output.skill_type
                      )}
                      {output.card_count != null &&
                        ` · ${t('skills.outputCards', { count: output.card_count })}`}
                    </span>
                    <div className="flex gap-1">
                      <button
                        onClick={() => onCopy(output.content)}
                        className="p-1 rounded hover:bg-sidebar-accent"
                        title="Copy"
                      >
                        <Copy className="w-3 h-3" />
                      </button>
                      <button
                        onClick={() => onToggle(null)}
                        className="p-1 rounded hover:bg-sidebar-accent"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="max-h-48 overflow-y-auto prose prose-xs prose-invert whitespace-pre-wrap break-words">
                    {output.content}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
