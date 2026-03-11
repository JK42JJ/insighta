import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useParams } from 'react-router-dom';
import { Grid3X3, ArrowLeft, Check } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { useAuth } from '@/features/auth/model/useAuth';
import {
  MANDALA_TEMPLATES,
  type MandalaTemplate,
  getTemplateTranslation,
} from '@/shared/data/mandalaTemplates';
import { GradientBackground } from '@/pages/landing/ui/components/GradientBackground';
import { LandingHeader } from '@/pages/landing/ui/components/LandingHeader';

const CATEGORIES = ['all', 'productivity', 'learning', 'business', 'personal'] as const;

export default function TemplatesPage() {
  const { templateId } = useParams<{ templateId?: string }>();
  const selectedTemplate = templateId ? MANDALA_TEMPLATES.find((t) => t.id === templateId) : null;

  if (selectedTemplate) {
    return <TemplateDetailView template={selectedTemplate} />;
  }

  return <TemplateListView />;
}

function TemplateListView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeCategory, setActiveCategory] = useState<string>('all');

  const filteredTemplates =
    activeCategory === 'all'
      ? MANDALA_TEMPLATES
      : MANDALA_TEMPLATES.filter((tpl) => tpl.category === activeCategory);

  return (
    <div className="relative min-h-screen bg-background">
      <GradientBackground variant="F" />

      <div className="relative z-10">
        <LandingHeader />

        <main className="py-12 md:py-20">
          <div className="mx-auto max-w-6xl px-4">
            <div className="text-center mb-10">
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                {t('templates.title')}
              </h1>
              <p className="mt-3 text-muted-foreground">{t('templates.subtitle')}</p>
            </div>

            <div className="flex justify-center gap-2 mb-10 flex-wrap">
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

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {filteredTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  onApply={() => navigate(`/templates/${template.id}`)}
                />
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function TemplateDetailView({ template }: { template: MandalaTemplate }) {
  const { t, i18n } = useTranslation();
  const { isLoggedIn } = useAuth();
  const navigate = useNavigate();
  const tpl = getTemplateTranslation(template, i18n.language);

  const handleApply = () => {
    if (!isLoggedIn) {
      navigate('/pricing');
      return;
    }
    navigate('/mandala-settings', { state: { templateId: template.id } });
  };

  return (
    <div className="relative min-h-screen bg-background">
      <GradientBackground variant="F" />

      <div className="relative z-10">
        <LandingHeader />

        <main className="py-12 md:py-20">
          <div className="mx-auto max-w-4xl px-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate('/templates')}
              className="mb-6 gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              {t('common.back')}
            </Button>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {/* Left: 3x3 preview */}
              <div className="rounded-xl border border-border/50 bg-card p-6">
                <div className="grid grid-cols-3 gap-1.5 p-4 rounded-lg bg-surface-base">
                  {Array.from({ length: 9 }).map((_, i) => {
                    const isCenter = i === 4;
                    const subjectIndex = i < 4 ? i : i > 4 ? i - 1 : -1;
                    const label = isCenter ? tpl.centerGoal : tpl.subjects[subjectIndex] || '';

                    return (
                      <div
                        key={i}
                        className={`aspect-square rounded-md flex items-center justify-center p-2 text-xs leading-tight text-center ${
                          isCenter
                            ? 'bg-primary/15 text-primary font-semibold border border-primary/30'
                            : label
                              ? 'bg-card text-foreground/70 border border-border/30'
                              : 'bg-surface-light'
                        }`}
                      >
                        <span className="line-clamp-2">{label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Right: Info + Apply */}
              <div className="flex flex-col gap-6">
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <span className="text-3xl">{template.icon}</span>
                    <h1 className="text-2xl font-bold">{tpl.name}</h1>
                  </div>
                  <p className="text-muted-foreground">{tpl.description}</p>
                </div>

                <div>
                  <h3 className="text-sm font-medium mb-3 text-foreground">
                    {t('templates.subjects')}
                  </h3>
                  <ul className="space-y-2">
                    {tpl.subjects.map((subject: string, i: number) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <Check className="w-4 h-4 text-primary flex-shrink-0" />
                        <span className="text-muted-foreground">{subject}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {template.category && (
                  <div>
                    <span className="inline-block px-3 py-1 rounded-full bg-primary/10 text-primary text-xs font-medium">
                      {t(`templates.categories.${template.category}`)}
                    </span>
                  </div>
                )}

                <Button size="lg" className="w-full rounded-full mt-auto" onClick={handleApply}>
                  {t('templates.applyButton')}
                </Button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function TemplateCard({ template, onApply }: { template: MandalaTemplate; onApply: () => void }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const tpl = getTemplateTranslation(template, i18n.language);

  return (
    <div
      className="rounded-xl border border-border/50 bg-card p-6 flex flex-col gap-4 hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer"
      style={{ boxShadow: 'var(--shadow-sm)' }}
      onClick={() => navigate(`/templates/${template.id}`)}
    >
      {/* Mini 3x3 preview */}
      <div className="grid grid-cols-3 gap-1 p-3 rounded-lg bg-surface-base">
        {Array.from({ length: 9 }).map((_, i) => {
          const isCenter = i === 4;
          const subjectIndex = i < 4 ? i : i > 4 ? i - 1 : -1;
          const label = isCenter ? tpl.centerGoal : tpl.subjects[subjectIndex] || '';

          return (
            <div
              key={i}
              className={`aspect-square rounded-md flex items-center justify-center p-1 text-[8px] sm:text-[9px] leading-tight text-center ${
                isCenter
                  ? 'bg-primary/15 text-primary font-semibold border border-primary/30'
                  : label
                    ? 'bg-card text-foreground/70 border border-border/30'
                    : 'bg-surface-light'
              }`}
            >
              <span className="line-clamp-2">{label}</span>
            </div>
          );
        })}
      </div>

      {/* Info */}
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <Grid3X3 className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-sm">{tpl.name}</h3>
        </div>
        <p className="text-xs text-muted-foreground line-clamp-2">{tpl.description}</p>
      </div>

      {/* Actions */}
      <Button
        size="sm"
        className="w-full rounded-full"
        onClick={(e) => {
          e.stopPropagation();
          onApply();
        }}
      >
        {t('templates.applyButton')}
      </Button>
    </div>
  );
}
