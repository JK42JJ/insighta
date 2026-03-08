interface MandalaPanelProps {
  centerGoal: string;
  totalCards: number;
  children: React.ReactNode;
}

export function FloatingMandala({ centerGoal, totalCards, children }: MandalaPanelProps) {
  return (
    <div className="h-full flex flex-col bg-surface-base">
      {/* Slim header: mandala title + card count badge */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/30 flex-shrink-0">
        <span className="text-xs font-medium text-muted-foreground truncate">
          {centerGoal || 'Mandala'}
        </span>
        <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full">
          {totalCards}
        </span>
      </div>
      {/* Mandala grid area — container query + centered */}
      <div
        className="flex-1 overflow-hidden p-3 flex items-center justify-center"
        style={{ containerType: 'size' }}
      >
        {children}
      </div>
    </div>
  );
}
