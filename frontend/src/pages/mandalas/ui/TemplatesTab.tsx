import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { MandalaMiniPreview } from '@/widgets/mandala-mini-preview';
import {
  MANDALA_TEMPLATES,
  type MandalaTemplate,
  getTemplateTranslation,
} from '@/shared/data/mandalaTemplates';
import { useCreateMandala } from '@/features/mandala';
import { toast } from '@/shared/lib/use-toast';

const CATEGORIES = ['all', 'productivity', 'learning', 'business', 'personal'] as const;

export function TemplatesTab() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const createMandala = useCreateMandala();

  const filteredTemplates =
    activeCategory === 'all'
      ? MANDALA_TEMPLATES
      : MANDALA_TEMPLATES.filter((tpl) => tpl.category === activeCategory);

  const handleUseTemplate = async (template: MandalaTemplate) => {
    const tpl = getTemplateTranslation(template, i18n.language);
    setApplyingId(template.id);
    try {
      const result = await createMandala.mutateAsync(tpl.name);
      const newId = result?.mandala?.id;
      if (newId) {
        navigate(`/mandalas/${newId}/edit`, { state: { templateId: template.id } });
      } else {
        navigate('/mandalas');
      }
      toast({ title: t('mandalaSettings.created') });
    } catch {
      toast({ title: t('mandalaSettings.quotaExceeded'), variant: 'destructive' });
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Category filter */}
      <div className="flex gap-2 flex-wrap">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
              activeCategory === cat
                ? 'bg-primary text-primary-foreground'
                : 'bg-surface-light text-muted-foreground hover:text-foreground'
            }`}
          >
            {t(`templates.categories.${cat}`)}
          </button>
        ))}
      </div>

      {/* Template grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTemplates.map((template) => {
          const tpl = getTemplateTranslation(template, i18n.language);
          const isApplying = applyingId === template.id;

          return (
            <div
              key={template.id}
              className="rounded-xl border border-border/50 bg-card p-4 flex flex-col gap-3 hover:border-primary/40 hover:shadow-lg transition-all duration-200"
            >
              <MandalaMiniPreview
                centerGoal={tpl.centerGoal}
                subjects={tpl.subjects}
                size="md"
              />

              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{template.icon}</span>
                  <h3 className="font-semibold text-sm">{tpl.name}</h3>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {tpl.description}
                </p>
              </div>

              <Button
                size="sm"
                className="w-full rounded-full"
                disabled={isApplying}
                onClick={() => handleUseTemplate(template)}
              >
                {isApplying ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                    {t('mandalas.creatingFromTemplate')}
                  </>
                ) : (
                  t('mandalas.useTemplate')
                )}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
