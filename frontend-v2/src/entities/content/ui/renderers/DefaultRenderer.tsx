import { Link } from 'lucide-react';
import type { CardRendererProps } from '../CardRendererRegistry';

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function DefaultRenderer({ card, view }: CardRendererProps) {
  const domain = extractDomain(card.sourceUrl);

  if (!domain) return null;

  const iconSize = view === 'list' || view === 'compact' ? 'w-2.5 h-2.5' : 'w-3 h-3';
  const textSize = view === 'list' || view === 'compact' ? 'text-[10px]' : 'text-xs';

  return (
    <div className={`flex items-center gap-1 ${textSize} text-muted-foreground`}>
      <Link className={`${iconSize} shrink-0`} aria-hidden="true" />
      <span className="truncate">{domain}</span>
    </div>
  );
}
