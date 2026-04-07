import {
  useWizard,
  WizardStepper,
  WizardStepGoal,
  WizardStepPreview,
  WizardStepSkills,
} from '@/features/mandala-wizard';

export default function MandalaWizardPage() {
  const wizard = useWizard();

  // Step 1 (Goal) uses wider layout for the 4-column card grid
  const isGoalStep = wizard.currentStep === 1;
  const containerClass = isGoalStep
    ? 'mx-auto max-w-[1080px] px-6 py-10'
    : 'mx-auto max-w-[720px] px-6 py-10';

  return (
    <div className={containerClass}>
      <div className="mb-10 text-[10px] font-bold uppercase tracking-[2px] text-foreground/[0.08]">
        /mandalas/new
      </div>

      <WizardStepper currentStep={wizard.currentStep} />

      {wizard.currentStep === 1 && (
        <WizardStepGoal
          goalInput={wizard.goalInput}
          searchResults={wizard.searchResults}
          isSearching={wizard.isSearching}
          aiGenerated={wizard.aiGenerated}
          aiSource={wizard.aiSource}
          isGenerating={wizard.isGenerating}
          generateError={wizard.generateError as Error | null}
          onSetGoalInput={wizard.setGoalInput}
          onSubmitGoal={wizard.submitGoal}
          onCancelGoal={wizard.cancelGoal}
          onClearGoal={wizard.clearGoal}
          onSelectSearchResult={wizard.selectSearchResult}
          onSelectGeneratedMandala={wizard.selectGeneratedMandala}
          onCreateBlank={wizard.createBlank}
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
