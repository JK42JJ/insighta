import { useMemo } from 'react';
import { Play, ExternalLink } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { parseNoteMarkdown, type ParsedSegment } from '@/shared/lib/note-markdown';

interface CompactNotePreviewProps {
  note: string;
  maxLines?: number;
  className?: string;
}

function SegmentRenderer({ segment }: { segment: ParsedSegment }) {
  if (segment.type === 'timestamp') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0 rounded-full text-[10px] font-medium bg-primary/10 text-primary">
        {segment.content}
        <Play className="w-2 h-2" />
      </span>
    );
  }

  if (segment.type === 'image') {
    return (
      <img
        src={segment.imageUrl}
        alt={segment.content}
        className="inline-block max-h-4 rounded align-text-bottom"
        loading="lazy"
      />
    );
  }

  if (segment.type === 'link') {
    return (
      <span className="text-primary inline-flex items-center gap-0.5">
        {segment.content}
        <ExternalLink className="w-2.5 h-2.5" />
      </span>
    );
  }

  return <span>{segment.content}</span>;
}

export function CompactNotePreview({ note, maxLines, className }: CompactNotePreviewProps) {
  const parsedLines = useMemo(() => parseNoteMarkdown(note), [note]);

  if (!note) return null;

  const clampClass = maxLines === 1
    ? 'line-clamp-1'
    : maxLines === 2
      ? 'line-clamp-2'
      : maxLines === 3
        ? 'line-clamp-3'
        : undefined;

  return (
    <div className={cn('text-xs text-muted-foreground', clampClass, className)}>
      {parsedLines.map((line, lineIdx) =>
        line.segments.length > 0 ? (
          <div key={lineIdx} className="whitespace-pre-wrap">
            {line.segments.map((seg, segIdx) => (
              <SegmentRenderer key={`${lineIdx}-${segIdx}`} segment={seg} />
            ))}
          </div>
        ) : (
          <div key={lineIdx}>&nbsp;</div>
        )
      )}
    </div>
  );
}
