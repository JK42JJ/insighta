import { useMemo } from 'react';
import { Play, ExternalLink, Bot } from 'lucide-react';
import { cn } from '@/shared/lib/utils';
import { parseNoteMarkdown, type ParsedSegment } from '@/shared/lib/note-markdown';
import { useTranslation } from 'react-i18next';

const AI_SUMMARY_PREFIX_EN = '🤖 AI Summary:\n';
const AI_SUMMARY_PREFIX_KO = '🤖 AI 요약:\n';

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

function AiSummaryPreview({ body, label, maxLines, className }: { body: string; label?: string; maxLines?: number; className?: string }) {
  const parsedLines = useMemo(() => parseNoteMarkdown(body), [body]);

  const clampClass = maxLines === 1
    ? 'line-clamp-1'
    : maxLines === 2
      ? 'line-clamp-2'
      : maxLines === 3
        ? 'line-clamp-3'
        : undefined;

  return (
    <div
      className={cn(
        'border-l-2 border-blue-400 pl-2 bg-blue-50/50 dark:bg-blue-950/30 rounded-r text-xs text-muted-foreground',
        clampClass,
        className,
      )}
    >
      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-blue-600 dark:text-blue-400 mb-0.5">
        <Bot className="w-3 h-3" />
        {label || 'AI Summary'}
      </span>
      {parsedLines.map((line, lineIdx) =>
        line.segments.length > 0 ? (
          <div key={lineIdx} className="whitespace-pre-wrap">
            {line.segments.map((seg, segIdx) => (
              <SegmentRenderer key={`${lineIdx}-${segIdx}`} segment={seg} />
            ))}
          </div>
        ) : (
          <div key={lineIdx}>&nbsp;</div>
        ),
      )}
    </div>
  );
}

/**
 * Extract the locale-appropriate AI summary from a bilingual note.
 * Note format: "🤖 AI Summary:\n{en}\n\n🤖 AI 요약:\n{ko}"
 */
function extractLocaleSummary(note: string, locale: string): { body: string; label: string } | null {
  const hasEn = note.includes(AI_SUMMARY_PREFIX_EN);
  const hasKo = note.includes(AI_SUMMARY_PREFIX_KO);

  if (!hasEn && !hasKo) return null;

  if (locale === 'ko' && hasKo) {
    const koStart = note.indexOf(AI_SUMMARY_PREFIX_KO) + AI_SUMMARY_PREFIX_KO.length;
    // Find end: next prefix or end of note
    const nextSection = note.indexOf('\n\n', koStart);
    // Check if what follows is user content (not another AI prefix)
    const body = nextSection >= 0 && !note.slice(nextSection).includes(AI_SUMMARY_PREFIX_EN)
      ? note.slice(koStart, nextSection)
      : note.slice(koStart).split('\n\n')[0]!;
    return { body: body.trim(), label: 'AI 요약' };
  }

  if (hasEn) {
    const enStart = note.indexOf(AI_SUMMARY_PREFIX_EN) + AI_SUMMARY_PREFIX_EN.length;
    // Find end: ko prefix or double newline
    const koIdx = note.indexOf(AI_SUMMARY_PREFIX_KO);
    const end = koIdx >= 0 ? note.lastIndexOf('\n\n', koIdx) : -1;
    const body = end > enStart ? note.slice(enStart, end) : note.slice(enStart).split('\n\n')[0]!;
    return { body: body.trim(), label: 'AI Summary' };
  }

  return null;
}

export function CompactNotePreview({ note, maxLines, className }: CompactNotePreviewProps) {
  const { i18n } = useTranslation();
  if (!note) return null;

  // Detect bilingual or single AI Summary and render locale-appropriate version
  const localeSummary = extractLocaleSummary(note, i18n.language);
  if (localeSummary) {
    return <AiSummaryPreview body={localeSummary.body} label={localeSummary.label} maxLines={maxLines} className={className} />;
  }

  const parsedLines = parseNoteMarkdown(note);

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
