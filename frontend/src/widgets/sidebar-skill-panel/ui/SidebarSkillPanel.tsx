import { useState, useCallback } from 'react';
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
} from 'lucide-react';
import { useSkillList, useSkillPreview, useSkillExecute, useSkillOutputs } from '@/features/skill';
import { useToast } from '@/shared/lib/use-toast';
import { apiClient, type SkillOutputResponse } from '@/shared/lib/api-client';

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

const SKILL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  newsletter: Mail,
  report: FileText,
  alert: Bell,
  recommend: Sparkles,
  script: Video,
  blog: PenLine,
  video_discover: Video,
};

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
}
const EXTRA_PRO_SKILLS: ReadonlyArray<ExtraProSkill> = [
  { id: 'pro-trend-analysis', shortLabelKey: 'shortProTrend', defaultLabel: '트렌드 분석' },
  { id: 'pro-auto-research', shortLabelKey: 'shortProAutoResearch', defaultLabel: '자동 리서치' },
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
      try {
        await apiClient.tokenReady;
        const token = apiClient.getAccessToken();
        const baseUrl = (apiClient as unknown as { baseUrl: string }).baseUrl;

        // CP358 SSOT: linked toggles. e.g. recommend → also flip video_discover
        // so the BE pipeline lights up alongside the user-visible toggle.
        const linked = LINKED_SKILL_TOGGLES[skillId] ?? [];
        const allKeys = [skillId, ...linked];
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

        // Invalidate the cache key shared with useDashboard so the badge re-renders.
        await queryClient.invalidateQueries({
          queryKey: ['mandala', 'dashboard', mandalaId],
        });
      } catch (err) {
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

  return (
    <div className="px-2">
      {/* Section header */}
      <button
        onClick={toggleCollapse}
        className="flex items-center gap-1 w-full text-left text-xs font-medium text-sidebar-foreground/60 hover:text-sidebar-foreground/80 py-1 px-1"
      >
        {collapsed ? <ChevronRight className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {t('skills.title')}
      </button>

      {!collapsed && (
        <div className="space-y-1 mt-1">
          {isLoading && (
            <div className="flex items-center justify-center py-3">
              <Loader2 className="w-4 h-4 animate-spin text-sidebar-foreground/60" />
            </div>
          )}

          {!isLoading && skills.length === 0 && (
            <p className="text-xs text-sidebar-foreground/60 px-1 py-2">{t('skills.empty')}</p>
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

          {skills.map((skill) => {
            const Icon = SKILL_ICONS[skill.id] ?? Sparkles;
            const isActive = previewData?.skillId === skill.id;
            const isPreviewing =
              previewMutation.isPending && previewMutation.variables?.skillId === skill.id;
            const isToggling = togglingSkillId === skill.id;

            return (
              <div key={skill.id} className="rounded-md">
                <button
                  onClick={() => handleToggleSkill(skill.id)}
                  disabled={isToggling}
                  className="flex items-center gap-2 w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-sidebar-accent transition-colors disabled:opacity-50"
                >
                  {isToggling ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  ) : (
                    <Icon className="w-3.5 h-3.5 shrink-0 text-sidebar-foreground/60" />
                  )}
                  <span className="truncate flex-1">
                    {t(
                      `skills.${SKILL_SHORT_LABEL_KEYS[skill.id] ?? SKILL_DESC_KEYS[skill.id] ?? skill.id}`,
                      skill.description
                    )}
                  </span>
                  <SkillStatusBadge
                    enabled={skillEnabledMap[skill.id] ?? false}
                    isPro={PRO_SKILL_TYPES.has(skill.id)}
                  />
                </button>

                {/* Preview panel — hidden in CP356 (logic preserved). */}
                {ENABLE_INLINE_SKILL_PANELS && isActive && previewData && (
                  <div className="mx-1 mt-1 mb-2 p-2 rounded bg-sidebar-accent/50 text-xs space-y-2">
                    {previewData.subject && <p className="font-medium">{previewData.subject}</p>}
                    {previewData.curated_count != null && (
                      <p className="text-sidebar-foreground/60">
                        {t('skills.curatedCount', { count: previewData.curated_count })}
                      </p>
                    )}
                    {previewData.preview_html && (
                      <div
                        className="prose prose-xs max-h-32 overflow-y-auto"
                        dangerouslySetInnerHTML={{ __html: previewData.preview_html }}
                      />
                    )}
                    <div className="flex gap-2 pt-1">
                      <button
                        onClick={() => handleExecute(skill.id)}
                        disabled={executeMutation.isPending}
                        className="flex-1 px-2 py-1 rounded text-xs font-medium bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                      >
                        {executeMutation.isPending ? t('skills.executing') : t('skills.execute')}
                      </button>
                      <button
                        onClick={() => setPreviewData(null)}
                        className="px-2 py-1 rounded text-xs text-sidebar-foreground/60 hover:bg-sidebar-accent"
                      >
                        {t('common.cancel')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Free / PRO divider */}
          {EXTRA_PRO_SKILLS.length > 0 && skills.length > 0 && (
            <div className="my-2 h-px bg-sidebar-border/60" aria-hidden="true" />
          )}

          {/* PRO (UI-only, no backend SkillId yet) */}
          {EXTRA_PRO_SKILLS.map((proSkill) => (
            <button
              key={proSkill.id}
              type="button"
              onClick={handleProClick}
              className="flex items-center gap-2 w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-sidebar-accent transition-colors opacity-80"
            >
              <Lock className="w-3.5 h-3.5 shrink-0 text-sidebar-foreground/40" />
              <span className="truncate flex-1">
                {t(`skills.${proSkill.shortLabelKey}`, proSkill.defaultLabel)}
              </span>
              <SkillStatusBadge enabled={false} isPro={true} />
            </button>
          ))}

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
// SkillStatusBadge — ON / OFF / PRO pill
// ---------------------------------------------------------------------------

function SkillStatusBadge({ enabled, isPro }: { enabled: boolean; isPro: boolean }) {
  if (isPro) {
    return (
      <span className="shrink-0 inline-flex items-center gap-0.5 text-[8px] font-bold px-1.5 py-0.5 rounded bg-primary/15 text-primary">
        <Lock className="w-2 h-2" />
        PRO
      </span>
    );
  }
  if (enabled) {
    return (
      <span className="shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-500">
        ON
      </span>
    );
  }
  return (
    <span className="shrink-0 text-[8px] font-bold px-1.5 py-0.5 rounded border border-border/60 text-muted-foreground">
      OFF
    </span>
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
