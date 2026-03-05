import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  GripVertical,
  Save,
  AlertTriangle,
  Sparkles,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { mandalaTemplates, MandalaTemplate } from '@/data/mandalaTemplates';
import { MandalaLevel } from '@/types/mandala';
import { mockMandalaLevels } from '@/data/mockData';
import { parseValidatedMandalaLevel, parseValidatedSubLevel } from '@/lib/localStorageValidation';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';

const GRID_ORDER = [0, 1, 2, 3, -1, 4, 5, 6, 7]; // -1 is center

export default function MandalaSettings() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { t } = useTranslation();

  // Load from localStorage or use mock data (with validation)
  const [mandalaData, setMandalaData] = useState<MandalaLevel>(() => {
    const validated = parseValidatedMandalaLevel('mandala-root');
    return validated || mockMandalaLevels['root'];
  });

  // Load all L2 levels from localStorage (with validation)
  const [subLevels, setSubLevels] = useState<Record<string, string[]>>(() => {
    const levels: Record<string, string[]> = {};
    // Check localStorage for existing sub-levels
    const keys = Object.keys(localStorage);
    keys.forEach((key) => {
      if (key.startsWith('mandala-l2-')) {
        const subjects = parseValidatedSubLevel(key);
        if (subjects) {
          levels[key.replace('mandala-l2-', '')] = subjects;
        }
      }
    });
    return levels;
  });

  const [editingCenterGoal, setEditingCenterGoal] = useState(mandalaData.centerGoal);
  const [editingSubjects, setEditingSubjects] = useState<string[]>([...mandalaData.subjects]);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const [showTemplateConfirm, setShowTemplateConfirm] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<MandalaTemplate | null>(null);
  const [expandedSubject, setExpandedSubject] = useState<number | null>(null);

  // Get or initialize sub-subjects for a given subject
  const getSubSubjects = (subject: string): string[] => {
    const key = subject.toLowerCase().replace(/\s/g, '');
    if (subLevels[key]) {
      return subLevels[key];
    }
    // Default sub-subjects
    return Array.from({ length: 8 }, (_, i) => `${subject} ${i + 1}`);
  };

  // Update sub-subject
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

  // Track changes
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

    // If subject name changed, migrate sub-levels
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

  const handleSave = () => {
    // Validation
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

    // Save to localStorage
    localStorage.setItem('mandala-root', JSON.stringify(updatedMandala));

    // Save all L2 levels
    editingSubjects.forEach((subject) => {
      if (subject.trim()) {
        const key = subject.toLowerCase().replace(/\s/g, '');
        const subs = subLevels[key] || getSubSubjects(subject);
        const l2Data: MandalaLevel = {
          id: key,
          centerGoal: subject,
          subjects: subs,
          parentId: 'root',
          parentCellIndex: editingSubjects.indexOf(subject),
          cards: [],
        };
        localStorage.setItem(`mandala-l2-${key}`, JSON.stringify(l2Data));
      }
    });

    setMandalaData(updatedMandala);
    setHasChanges(false);

    toast({
      title: t('mandalaSettings.saved'),
      description: t('mandalaSettings.savedDesc'),
    });
  };

  const handleTemplateClick = (template: MandalaTemplate) => {
    // Check if mandala already has content
    const hasContent =
      mandalaData.centerGoal !== '2024년 목표' ||
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
    setEditingCenterGoal(template.centerGoal);
    setEditingSubjects([...template.subjects]);
    setShowTemplateConfirm(false);
    setSelectedTemplate(null);

    toast({
      title: t('mandalaSettings.templateApplied'),
      description: t('mandalaSettings.templateAppliedDesc', { name: template.name }),
    });
  };

  const getSubjectIndex = (gridIndex: number): number => {
    const mapping = [0, 1, 2, 3, -1, 4, 5, 6, 7];
    return mapping[gridIndex];
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
            >
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div>
              <h1 className="text-xl font-bold text-foreground">{t('mandalaSettings.title')}</h1>
              <p className="text-sm text-muted-foreground">{t('mandalaSettings.subtitle')}</p>
            </div>
          </div>
          <Button onClick={handleSave} disabled={!hasChanges} className="gap-2">
            <Save className="w-4 h-4" />
            {t('common.save')}
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
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
                  {mandalaTemplates.map((template) => (
                    <button
                      key={template.id}
                      onClick={() => handleTemplateClick(template)}
                      className="text-left p-4 rounded-xl bg-surface-light border border-border/30 hover:border-primary/50 hover:bg-surface-light/80 transition-all duration-200 group"
                    >
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">{template.icon}</span>
                        <div className="flex-1 min-w-0">
                          <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">
                            {template.name}
                          </h3>
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            {template.description}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Tips */}
            <Card className="bg-surface-mid border-border/50">
              <CardHeader>
                <CardTitle className="text-lg">{t('mandalaSettings.designTips')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <p>• {t('mandalaSettings.tip1')}</p>
                <p>• {t('mandalaSettings.tip2')}</p>
                <p>• {t('mandalaSettings.tip3')}</p>
                <p>• {t('mandalaSettings.tip4')}</p>
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
              {t('mandalaSettings.overwriteDesc', { name: selectedTemplate?.name })}
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
