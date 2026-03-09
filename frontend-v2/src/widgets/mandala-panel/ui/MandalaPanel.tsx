import { useTranslation } from 'react-i18next';
import { Pin, PinOff } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { MandalaSelector } from '@/features/mandala/ui/MandalaSelector';
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from '@/shared/ui/sheet';

interface MandalaPanelProps {
  mode: 'pinned' | 'floating';
  totalCards: number;
  children: React.ReactNode;
  onToggleMode: () => void;
  isOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}

interface PanelHeaderProps {
  totalCards: number;
  mode: 'pinned' | 'floating';
  onToggleMode: () => void;
}

function PanelHeader({
  totalCards,
  mode,
  onToggleMode,
}: PanelHeaderProps) {
  const { t } = useTranslation();

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 flex-shrink-0">
      <div className="flex-1 min-w-0 flex items-center gap-2">
        <MandalaSelector />
        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full shrink-0">
          {totalCards}
        </span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={onToggleMode}
        aria-label={mode === 'pinned' ? t('mandala.switchToFloating') : t('mandala.switchToDock')}
      >
        {mode === 'pinned' ? (
          <PinOff className="w-3.5 h-3.5 text-muted-foreground" />
        ) : (
          <Pin className="w-3.5 h-3.5 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
}

function PanelBody({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex-1 overflow-hidden p-3 flex items-center justify-center"
      style={{ containerType: 'size' }}
    >
      {children}
    </div>
  );
}

export function MandalaPanel({
  mode,
  totalCards,
  children,
  onToggleMode,
  isOpen = false,
  onOpenChange,
}: MandalaPanelProps) {
  if (mode === 'floating') {
    return (
      <Sheet open={isOpen} onOpenChange={onOpenChange}>
        <SheetContent
          side="left"
          className="w-[360px] sm:max-w-[400px] p-0 bg-surface-base flex flex-col"
          aria-describedby={undefined}
        >
          <SheetTitle className="sr-only">Mandala Panel</SheetTitle>
          <PanelHeader
            totalCards={totalCards}
            mode={mode}
            onToggleMode={onToggleMode}
          />
          <PanelBody>{children}</PanelBody>
        </SheetContent>
      </Sheet>
    );
  }

  // Pinned mode — inline panel
  return (
    <div className="h-full flex flex-col bg-surface-base">
      <PanelHeader
        totalCards={totalCards}
        mode={mode}
        onToggleMode={onToggleMode}
      />
      <PanelBody>{children}</PanelBody>
    </div>
  );
}
