import { useState, useCallback } from 'react';
import { trackSkillActivated } from '@/shared/lib/posthog';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatRelativeDate } from '@/shared/lib/format-date';
import {
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

  return (
    <div>
      <div>
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

        {/* ─── Skill list — ChatGPT More pattern (CP441) ─── */}
        <div className="flex flex-col max-h-[320px] overflow-y-auto scrollbar-thin">
          {(showAll ? skills : skills.slice(0, 6)).map((skill) => {
            const Icon = SKILL_ICONS[skill.id] ?? Sparkles;
            const isEnabled = skillEnabledMap[skill.id] ?? false;
            const isToggling = togglingSkillId === skill.id;

            return (
              <button
                key={skill.id}
                type="button"
                onClick={() => handleToggleSkill(skill.id)}
                disabled={isToggling}
                className={cn(
                  'flex items-center gap-3 px-4 py-2.5 rounded-md select-none transition-colors duration-150',
                  'hover:bg-sidebar-accent',
                  isEnabled ? 'text-sidebar-foreground' : 'text-sidebar-foreground/65',
                  isToggling && 'opacity-50 pointer-events-none'
                )}
              >
                {isToggling ? (
                  <Loader2 className="w-4 h-4 shrink-0 animate-spin text-sidebar-foreground/50" />
                ) : (
                  <Icon className="w-4 h-4 shrink-0" strokeWidth={1.75} />
                )}
                <span className="flex-1 text-left text-[14px] truncate">
                  {t(
                    `skills.${SKILL_SHORT_LABEL_KEYS[skill.id] ?? SKILL_DESC_KEYS[skill.id] ?? skill.id}`,
                    skill.description
                  )}
                </span>
                {isEnabled && (
                  <span
                    className="w-1.5 h-1.5 shrink-0 rounded-full bg-emerald-500"
                    aria-label={t('skills.active', '활성')}
                  />
                )}
              </button>
            );
          })}
        </div>

        {/* Show more toggle */}
        {skills.length > 6 && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="w-full text-center text-[12px] font-medium text-sidebar-foreground/50 hover:text-sidebar-foreground/75 py-1.5 transition-colors duration-150"
          >
            {showAll
              ? t('skills.showLess', '접기')
              : t('skills.showMore', `+${skills.length - 6}개 더보기`)}
          </button>
        )}

        {/* PRO skills — same list pattern, opacity-50 disabled (CP441) */}
        <div className="flex flex-col">
          {EXTRA_PRO_SKILLS.map((proSkill) => {
            const ProIcon = proSkill.icon;
            return (
              <button
                key={proSkill.id}
                type="button"
                onClick={handleProClick}
                className="flex items-center gap-3 px-4 py-2.5 rounded-md select-none transition-colors duration-150 hover:bg-sidebar-accent opacity-50"
              >
                <ProIcon
                  className="w-4 h-4 shrink-0 text-sidebar-foreground/70"
                  strokeWidth={1.75}
                />
                <span className="flex-1 text-left text-[14px] text-sidebar-foreground/80 truncate">
                  {t(`skills.${proSkill.shortLabelKey}`, proSkill.defaultLabel)}
                </span>
                <span
                  className="shrink-0 inline-flex items-center px-1.5 py-px rounded-[3px] text-[9px] font-extrabold tracking-wider"
                  style={{
                    background: 'rgba(251,191,36,0.12)',
                    color: '#fbbf24',
                  }}
                >
                  PRO
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
    </div>
  );
}

// ---------------------------------------------------------------------------
// SkillOutputHistory — collapsible list of past outputs
// ---------------------------------------------------------------------------

// Skill type labels are now in i18n: skills.typeNewsletter, skills.typeReport, etc.

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
