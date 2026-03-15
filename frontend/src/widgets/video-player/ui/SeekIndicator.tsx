import { Rewind, FastForward } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface SeekIndicatorProps {
  direction: 'forward' | 'backward';
  seconds: number;
}

export function SeekIndicator({ direction, seconds }: SeekIndicatorProps) {
  const { t } = useTranslation();

  return (
    <div className="absolute bottom-16 left-0 right-0 flex justify-center pointer-events-none z-10">
      <div className="flex items-center gap-2 px-4 py-2 rounded-full">
        {direction === 'backward' ? (
          <>
            <Rewind className="w-5 h-5 text-foreground/50" />
            <span className="text-sm font-medium text-foreground/50">
              {seconds}
              {t('videoPlayer.secondsUnit')}
            </span>
          </>
        ) : (
          <>
            <span className="text-sm font-medium text-foreground/50">
              {seconds}
              {t('videoPlayer.secondsUnit')}
            </span>
            <FastForward className="w-5 h-5 text-foreground/50" />
          </>
        )}
      </div>
    </div>
  );
}
