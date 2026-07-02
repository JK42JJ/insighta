/**
 * WelcomeModal — moment 1: first login with zero mandalas.
 *
 * One card, one job: hand the user to the wizard (the wizard itself is the
 * real onboarding act 1). Secondary path = browse templates.
 */
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Dialog, DialogContent } from '@/shared/ui/dialog';
import { Compass, Sparkles } from 'lucide-react';

interface Props {
  onClose: () => void;
}

export function WelcomeModal({ onClose }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md rounded-xl border-border/40 bg-popover p-8 text-center [&>button]:hidden">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/15">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <h2 className="mt-4 text-[17px] font-semibold text-foreground">
          {t('onboarding.welcome.title', 'Insighta에 오신 걸 환영해요')}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {t(
            'onboarding.welcome.body',
            '목표를 입력하면 달성에 필요한 8개 실행영역으로 나누고, 영역마다 엄선한 영상 커리큘럼을 만들어 드려요.'
          )}
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={() => {
              onClose();
              navigate('/mandalas/new');
            }}
            className="h-10 rounded-lg bg-primary text-[13.5px] font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            {t('onboarding.welcome.cta', '목표로 시작하기')}
          </button>
          <button
            type="button"
            onClick={() => {
              onClose();
              navigate('/explore');
            }}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg text-[12.5px] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.05] transition-colors"
          >
            <Compass className="h-3.5 w-3.5" />
            {t('onboarding.welcome.browse', '템플릿 둘러보기')}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
