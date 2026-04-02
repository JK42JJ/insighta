import { useNavigate } from 'react-router-dom';

import {
  useWizard,
  WizardStepper,
  WizardStepDomain,
  WizardStepPreview,
  WizardStepSkills,
} from '@/features/mandala-wizard';

export default function MandalaWizardPage() {
  const navigate = useNavigate();
  const wizard = useWizard();

  return (
    <div className="mx-auto max-w-[720px] px-6 py-10">
      <div className="mb-10 text-[10px] font-bold uppercase tracking-[2px] text-foreground/[0.08]">
        /mandalas/new
      </div>

      <WizardStepper currentStep={wizard.currentStep} />

      {wizard.currentStep === 1 && (
        <WizardStepDomain
          selectedDomain={wizard.selectedDomain}
          templates={wizard.templates}
          isLoadingTemplates={wizard.isLoadingTemplates}
          onSelectDomain={wizard.selectDomain}
          onSelectTemplate={wizard.selectTemplate}
          onCreateBlank={() => navigate('/mandalas/create')}
        />
      )}

      {wizard.currentStep === 2 && wizard.selectedTemplate && (
        <WizardStepPreview
          template={wizard.selectedTemplate}
          isLoadingDetail={wizard.isLoadingDetail}
          onConfirm={() => wizard.goToStep(3)}
          onBack={() => wizard.goToStep(1)}
        />
      )}

      {wizard.currentStep === 3 && (
        <WizardStepSkills
          skills={wizard.skills}
          onSetSkill={wizard.setSkill}
          onComplete={wizard.complete}
          isCreating={wizard.isCreating}
        />
      )}

      {wizard.createError && (
        <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-center text-sm text-destructive">
          {wizard.createError.message}
        </div>
      )}
    </div>
  );
}
