import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  GripVertical,
  Loader2,
  Save,
  AlertTriangle,
  Sparkles,
  ChevronDown,
  ChevronRight,
  Globe,
  Copy,
  Link,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/card';
import { useToast } from '@/shared/lib/use-toast';
import { mandalaTemplates, type MandalaTemplate, getTemplateTranslation } from '@/shared/data/mandalaTemplates';
import { MandalaLevel } from '@/entities/card/model/types';
import { mockMandalaLevels } from '@/shared/data/mockData';
import { useMandalaQuery, useMandalaList, useToggleMandalaShare, MandalaSelector } from '@/features/mandala';
import { Switch } from '@/shared/ui/switch';
import { Label } from '@/shared/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/shared/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/shared/ui/collapsible';

const GRID_ORDER = [0, 1, 2, 3, -1, 4, 5, 6, 7]; // -1 is center

export default function MandalaSettingsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t, i18n } = useTranslation();
  const { mandalaLevels: queryLevels, isSaving, saveMandala } = useMandalaQuery();
  const { data: listData } = useMandalaList();
  const toggleShare = useToggleMandalaShare();

  // Derive mandala data from query
  const [mandalaData, setMandalaData] = useState<MandalaLevel>(() => {
    return queryLevels['root'] || mockMandalaLevels['root'];
  });

  // Derive L2 sub-levels from query
  const [subLevels, setSubLevels] = useState<Record<string, string[]>>(() => {
    const levels: Record<string, string[]> = {};
    for (const [key, level] of Object.entries(queryLevels)) {
      if (key === 'root') continue;
      levels[key] = level.subjects;
    }
    return levels;
  });

  const [editingCenterGoal, setEditingCenterGoal] = useState(mandalaData.centerGoal);
  const [editingSubjects, setEditingSubjects] = useState<string[]>([...mandalaData.subjects]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [showTemplateConfirm, setShowTemplateConfirm] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<MandalaTemplate | null>(null);
  const [expandedSubject, setExpandedSubject] = useState<number | null>(null);

  // Sync query data changes to local state
  useEffect(() => {
    const root = queryLevels['root'];
    if (root && !hasChanges) {
      setMandalaData(root);
      setEditingCenterGoal(root.centerGoal);
      setEditingSubjects([...root.subjects]);
      const levels: Record<string, string[]> = {};
      for (const [key, level] of Object.entries(queryLevels)) {
        if (key === 'root') continue;
        levels[key] = level.subjects;
      }
      setSubLevels(levels);
    }
  }, [queryLevels]);

  const getSubSubjects = (subject: string): string[] => {
    const key = subject.toLowerCase().replace(/\s/g, '');
    if (subLevels[key]) {
      return subLevels[key];
    }
    return Array.from({ length: 8 }, (_, i) => `${subject} ${i + 1}`);
  };

  const handleSubSubjectChange = (subjectIndex: number, subIndex: number, value: string) => {
    const subject = editingSubjects[subjectIndex];
    const key = subject.toLowerCase().replace(/\s/g, '');
    const currentSubs = getSubSubjects(subject);
    const newSubs = [...currentSubs];
    newSubs[subIndex] = value;

    setSubLevels((prev) => ({
      ...prev,
      [key]: newSubs,
    }));
    setHasChanges(true);
  };

  useEffect(() => {
    const centerChanged = editingCenterGoal !== mandalaData.centerGoal;
    const subjectsChanged =
      JSON.stringify(editingSubjects) !== JSON.stringify(mandalaData.subjects);
    if (centerChanged || subjectsChanged) {
      setHasChanges(true);
    }
  }, [editingCenterGoal, editingSubjects, mandalaData]);

  const handleSubjectChange = (index: number, value: string) => {
    const oldSubject = editingSubjects[index];
    const newSubjects = [...editingSubjects];
    newSubjects[index] = value;
    setEditingSubjects(newSubjects);

    if (oldSubject !== value && oldSubject.trim()) {
      const oldKey = oldSubject.toLowerCase().replace(/\s/g, '');
      const newKey = value.toLowerCase().replace(/\s/g, '');
      if (subLevels[oldKey]) {
        setSubLevels((prev) => {
          const updated = { ...prev };
          updated[newKey] = prev[oldKey];
          delete updated[oldKey];
          return updated;
        });
      }
    }
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    const newSubjects = [...editingSubjects];
    const [removed] = newSubjects.splice(draggedIndex, 1);
    newSubjects.splice(targetIndex, 0, removed);
    setEditingSubjects(newSubjects);
    setDraggedIndex(null);
  };

  const handleSave = async () => {
    if (!editingCenterGoal.trim()) {
      toast({
        title: t('mandalaSettings.saveFailed'),
        description: t('mandalaSettings.saveFailedCenterRequired'),
        variant: 'destructive',
      });
      return;
    }

    const validSubjects = editingSubjects.filter((s) => s.trim());
    if (validSubjects.length === 0) {
      toast({
        title: t('mandalaSettings.saveFailed'),
        description: t('mandalaSettings.saveFailedSubjectRequired'),
        variant: 'destructive',
      });
      return;
    }

    const updatedMandala: MandalaLevel = {
      ...mandalaData,
      centerGoal: editingCenterGoal.trim(),
      subjects: editingSubjects.map((s) => s.trim() || ''),
    };

    // Build full levels record for API save
    const updatedLevels: Record<string, MandalaLevel> = {
      root: updatedMandala,
    };

    editingSubjects.forEach((subject, idx) => {
      if (subject.trim()) {
        const key = subject.toLowerCase().replace(/\s/g, '');
        const subs = subLevels[key] || getSubSubjects(subject);
        updatedLevels[key] = {
          id: key,
          centerGoal: subject,
          subjects: subs,
          parentId: 'root',
          parentCellIndex: idx,
          cards: [],
        };
      }
    });

    try {
      await saveMandala(updatedLevels);
      setMandalaData(updatedMandala);
      setHasChanges(false);
      toast({
        title: t('mandalaSettings.saved'),
        description: t('mandalaSettings.savedDesc'),
      });
    } catch {
      toast({
        title: t('mandalaSettings.saveFailed'),
        description: t('mandalaSettings.saveFailedGeneric', { defaultValue: 'Failed to save. Please try again.' }),
        variant: 'destructive',
      });
    }
  };

  const handleTemplateClick = (template: MandalaTemplate) => {
    const hasContent =
      mandalaData.centerGoal !== '2024 Goals' ||
      mandalaData.subjects.some(
        (s) => s !== mockMandalaLevels['root'].subjects[mandalaData.subjects.indexOf(s)]
      );

    if (hasContent) {
      setSelectedTemplate(template);
      setShowTemplateConfirm(true);
    } else {
      applyTemplate(template);
    }
  };

  const applyTemplate = (template: MandalaTemplate) => {
    const tpl = getTemplateTranslation(template, i18n.language);
    setEditingCenterGoal(tpl.centerGoal);
    setEditingSubjects([...tpl.subjects]);
    setShowTemplateConfirm(false);
    setSelectedTemplate(null);

    toast({
      title: t('mandalaSettings.templateApplied'),
      description: t('mandalaSettings.templateAppliedDesc', { name: tpl.name }),
    });
  };

  return (
    <div className="min-h-screen bg-surface-base">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-surface-mid/95 backdrop-blur-md border-b border-border/50">
        <div className="container mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => navigate('/')}
              className="rounded-lg"
              aria-label={t('common.back')}
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold text-foreground">{t('mandalaSettings.title')}</h1>
                <MandalaSelector />
              </div>
              <p className="text-sm text-muted-foreground">{t('mandalaSettings.subtitle')}</p>
            </div>
          </div>
          <Button onClick={handleSave} disabled={!hasChanges || isSaving} className="gap-2">
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {t('common.save')}
          </Button>
        </div>
      </header>

      <main id="main-content" className="container mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-2 gap-8">
          {/* Left: Mandala Preview & Editor */}
          <div className="space-y-6">
            <Card className="bg-surface-mid border-border/50">
              <CardHeader>
                <CardTitle className="text-lg">{t('mandalaSettings.l1Edit')}</CardTitle>
                <CardDescription>{t('mandalaSettings.l1EditDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                {/* 3x3 Grid Preview */}
                <div className="grid grid-cols-3 gap-2 aspect-square max-w-md mx-auto">
                  {GRID_ORDER.map((subjectIdx, gridIdx) => {
                    const isCenter = subjectIdx === -1;

                    if (isCenter) {
                      return (
                        <div
                          key="center"
                          className="bg-primary/20 border-2 border-primary rounded-lg p-2 flex items-center justify-center"
                        >
                          <Input
                            value={editingCenterGoal}
                            onChange={(e) => setEditingCenterGoal(e.target.value)}
                            placeholder={t('mandalaSettings.centerGoalPlaceholder')}
                            className="text-center text-sm font-semibold bg-transparent border-0 focus-visible:ring-0 h-auto p-1"
                            maxLength={50}
                          />
                        </div>
                      );
                    }

                    const subject = editingSubjects[subjectIdx] || '';
                    const isEmpty = !subject.trim();

                    return (
                      <div
                        key={gridIdx}
                        draggable
                        onDragStart={(e) => handleDragStart(e, subjectIdx)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, subjectIdx)}
                        className={`
                          relative group cursor-grab active:cursor-grabbing
                          bg-surface-light border border-border/50 rounded-lg p-2
                          transition-all duration-200
                          ${draggedIndex === subjectIdx ? 'opacity-50 scale-95' : ''}
                          ${isEmpty ? 'border-dashed opacity-60' : ''}
                          hover:border-primary/50 hover:shadow-md
                        `}
                      >
                        <GripVertical className="absolute top-1 left-1 w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                        <Input
                          value={subject}
                          onChange={(e) => handleSubjectChange(subjectIdx, e.target.value)}
                          placeholder={t('mandalaSettings.subjectPlaceholder', {
                            index: subjectIdx + 1,
                          })}
                          className="text-center text-xs bg-transparent border-0 focus-visible:ring-0 h-auto p-1"
                          maxLength={30}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Subject List with expandable L2 */}
                <div className="mt-6 space-y-2">
                  <p className="text-sm font-medium text-muted-foreground mb-3">
                    {t('mandalaSettings.subjectList')}
                  </p>
                  {editingSubjects.map((subject, idx) => (
                    <Collapsible
                      key={idx}
                      open={expandedSubject === idx}
                      onOpenChange={(open) => setExpandedSubject(open ? idx : null)}
                    >
                      <div
                        draggable
                        onDragStart={(e) => handleDragStart(e, idx)}
                        onDragOver={handleDragOver}
                        onDrop={(e) => handleDrop(e, idx)}
                        className={`
                          rounded-lg bg-surface-light border border-border/30
                          transition-all duration-200
                          ${draggedIndex === idx ? 'opacity-50 scale-95' : ''}
                          ${expandedSubject === idx ? 'border-primary/50 ring-1 ring-primary/20' : 'hover:border-primary/50'}
                        `}
                      >
                        <CollapsibleTrigger asChild>
                          <div className="flex items-center gap-2 p-2 cursor-pointer">
                            <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0 cursor-grab" />
                            <span className="w-6 h-6 flex items-center justify-center text-xs font-medium text-muted-foreground bg-surface-mid rounded">
                              {idx + 1}
                            </span>
                            <Input
                              value={subject}
                              onChange={(e) => {
                                e.stopPropagation();
                                handleSubjectChange(idx, e.target.value);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              placeholder={t('mandalaSettings.subjectPlaceholder', {
                                index: idx + 1,
                              })}
                              className="flex-1 bg-transparent border-0 focus-visible:ring-1 h-8 text-sm"
                              maxLength={30}
                            />
                            {subject.trim() && (
                              <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                            )}
                            {expandedSubject === idx ? (
                              <ChevronDown className="w-4 h-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-muted-foreground" />
                            )}
                          </div>
                        </CollapsibleTrigger>

                        <CollapsibleContent>
                          {subject.trim() && (
                            <div className="px-4 pb-3 pt-1 border-t border-border/30 space-y-1.5">
                              <p className="text-xs text-muted-foreground mb-2">
                                {t('mandalaSettings.l2SubItems')}
                              </p>
                              {getSubSubjects(subject).map((subItem, subIdx) => (
                                <div key={subIdx} className="flex items-center gap-2">
                                  <span className="w-5 h-5 flex items-center justify-center text-[10px] font-medium text-muted-foreground bg-surface-mid rounded">
                                    {subIdx + 1}
                                  </span>
                                  <Input
                                    value={subItem}
                                    onChange={(e) =>
                                      handleSubSubjectChange(idx, subIdx, e.target.value)
                                    }
                                    placeholder={`${subject} ${subIdx + 1}`}
                                    className="flex-1 bg-surface-mid/50 border-0 focus-visible:ring-1 h-7 text-xs"
                                    maxLength={30}
                                  />
                                </div>
                              ))}
                            </div>
                          )}
                        </CollapsibleContent>
                      </div>
                    </Collapsible>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right: Templates */}
          <div className="space-y-6">
            <Card className="bg-surface-mid border-border/50">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  <CardTitle className="text-lg">
                    {t('mandalaSettings.startWithTemplate')}
                  </CardTitle>
                </div>
                <CardDescription>{t('mandalaSettings.startWithTemplateDesc')}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid sm:grid-cols-2 gap-3">
                  {mandalaTemplates.map((template) => {
                    const tpl = getTemplateTranslation(template, i18n.language);
                    return (
                      <button
                        key={template.id}
                        onClick={() => handleTemplateClick(template)}
                        className="text-left p-4 rounded-xl bg-surface-light border border-border/30 hover:border-primary/50 hover:bg-surface-light/80 transition-all duration-200 group"
                      >
                        <div className="flex items-start gap-3">
                          <span className="text-2xl">{template.icon}</span>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                              {tpl.name}
                            </h3>
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {tpl.description}
                            </p>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Share Settings */}
            {(() => {
              const currentMandala = listData?.mandalas?.find((m) => m.isDefault) ?? listData?.mandalas?.[0];
              if (!currentMandala) return null;
              const shareUrl = currentMandala.shareSlug
                ? `${window.location.origin}/explore/${currentMandala.shareSlug}`
                : null;
              return (
                <Card className="bg-surface-mid border-border/50">
                  <CardHeader>
                    <div className="flex items-center gap-2">
                      <Globe className="w-5 h-5 text-primary" />
                      <CardTitle className="text-lg">{t('share.toggleLabel')}</CardTitle>
                    </div>
                    <CardDescription>{t('share.toggleDesc')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="share-toggle" className="text-sm font-medium">
                        {t('share.toggleLabel')}
                      </Label>
                      <Switch
                        id="share-toggle"
                        checked={currentMandala.isPublic}
                        disabled={toggleShare.isPending}
                        onCheckedChange={(checked) => {
                          toggleShare.mutate(
                            { id: currentMandala.id, isPublic: checked },
                            {
                              onSuccess: () => {
                                toast({
                                  title: checked ? t('share.enabled') : t('share.disabled'),
                                  description: checked
                                    ? t('share.enabledDesc')
                                    : t('share.disabledDesc'),
                                });
                              },
                            },
                          );
                        }}
                      />
                    </div>
                    {currentMandala.isPublic && shareUrl && (
                      <div className="flex items-center gap-2 p-3 bg-surface-light rounded-lg">
                        <Link className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <span className="text-sm text-muted-foreground truncate flex-1">
                          {shareUrl}
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard.writeText(shareUrl);
                            toast({
                              title: t('share.linkCopied'),
                            });
                          }}
                          className="flex-shrink-0"
                        >
                          <Copy className="w-4 h-4" />
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}

            {/* Tips */}
            <Card className="bg-surface-mid border-border/50">
              <CardHeader>
                <CardTitle className="text-lg">{t('mandalaSettings.designTips')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>* {t('mandalaSettings.tip1')}</p>
                <p>* {t('mandalaSettings.tip2')}</p>
                <p>* {t('mandalaSettings.tip3')}</p>
                <p>* {t('mandalaSettings.tip4')}</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Template Confirmation Dialog */}
      <AlertDialog open={showTemplateConfirm} onOpenChange={setShowTemplateConfirm}>
        <AlertDialogContent className="bg-surface-mid border-border/50">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-amber-500" />
              {t('mandalaSettings.overwriteTitle')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('mandalaSettings.overwriteDesc', { name: selectedTemplate ? getTemplateTranslation(selectedTemplate, i18n.language).name : '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => selectedTemplate && applyTemplate(selectedTemplate)}>
              {t('common.apply')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
