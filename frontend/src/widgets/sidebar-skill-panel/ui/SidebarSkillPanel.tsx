import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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
} from 'lucide-react';
import { useSkillList, useSkillPreview, useSkillExecute } from '@/features/skill';
import { useToast } from '@/shared/lib/use-toast';

const SKILL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  newsletter: Mail,
  report: FileText,
  alert: Bell,
  recommend: Sparkles,
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

  const { data: skillsResponse, isLoading } = useSkillList();
  const previewMutation = useSkillPreview();
  const executeMutation = useSkillExecute();

  const skills = skillsResponse?.data ?? [];

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
        toast({ title: result.data.error || t('skills.error'), variant: 'destructive' });
      }
      setPreviewData(null);
    } catch {
      toast({ title: t('skills.error'), variant: 'destructive' });
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

          {/* Skill output result panel */}
          {outputData && (
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

            return (
              <div key={skill.id} className="rounded-md">
                <button
                  onClick={() => handlePreview(skill.id)}
                  disabled={isPreviewing}
                  className="flex items-center gap-2 w-full text-left text-xs px-2 py-1.5 rounded-md hover:bg-sidebar-accent transition-colors disabled:opacity-50"
                >
                  {isPreviewing ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                  ) : (
                    <Icon className="w-3.5 h-3.5 shrink-0 text-sidebar-foreground/60" />
                  )}
                  <span className="truncate">{skill.description}</span>
                </button>

                {/* Preview panel */}
                {isActive && previewData && (
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
        </div>
      )}
    </div>
  );
}
