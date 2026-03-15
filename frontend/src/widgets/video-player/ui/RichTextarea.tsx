import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Play } from 'lucide-react';

const TIMESTAMP_REGEX_SOURCE = '\\[([^\\]]+)\\]\\((https?:\\/\\/[^\\)]+)\\)';

interface RichTextareaProps {
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
  onBlur?: () => void;
  onTimestampClick?: (url: string) => void;
}

/**
 * A line-by-line editor that renders timestamp chips inline.
 * Non-focused lines show chips; the focused line shows raw markdown.
 */
export function RichTextarea({
  value,
  onChange,
  onKeyDown,
  placeholder,
  className,
  autoFocus,
  onBlur,
  onTimestampClick,
}: RichTextareaProps) {
  const lines = useMemo(() => value.split('\n'), [value]);
  const [editingLine, setEditingLine] = useState<number | null>(
    autoFocus ? (lines.length > 0 ? lines.length - 1 : 0) : null
  );
  const inputRefs = useRef<Map<number, HTMLInputElement>>(new Map());
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus the editing line's input
  useEffect(() => {
    if (editingLine !== null) {
      const input = inputRefs.current.get(editingLine);
      if (input) {
        input.focus();
        const len = input.value.length;
        input.setSelectionRange(len, len);
      }
    }
  }, [editingLine]);

  const updateLine = useCallback(
    (lineIndex: number, newLineValue: string) => {
      const newLines = [...lines];
      newLines[lineIndex] = newLineValue;
      onChange(newLines.join('\n'));
    },
    [lines, onChange]
  );

  const handleLineKeyDown = useCallback(
    (e: React.KeyboardEvent, lineIndex: number) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const input = e.target as HTMLInputElement;
        const cursorPos = input.selectionStart ?? input.value.length;
        const before = input.value.slice(0, cursorPos);
        const after = input.value.slice(cursorPos);

        const newLines = [...lines];
        newLines[lineIndex] = before;
        newLines.splice(lineIndex + 1, 0, after);
        onChange(newLines.join('\n'));
        setEditingLine(lineIndex + 1);
      } else if (e.key === 'Backspace' && lineIndex > 0) {
        const input = e.target as HTMLInputElement;
        if (input.selectionStart === 0 && input.selectionEnd === 0) {
          e.preventDefault();
          const newLines = [...lines];
          const prevLen = newLines[lineIndex - 1].length;
          newLines[lineIndex - 1] += newLines[lineIndex];
          newLines.splice(lineIndex, 1);
          onChange(newLines.join('\n'));
          setEditingLine(lineIndex - 1);
          setTimeout(() => {
            const prev = inputRefs.current.get(lineIndex - 1);
            if (prev) prev.setSelectionRange(prevLen, prevLen);
          }, 0);
        }
      } else if (e.key === 'ArrowUp' && lineIndex > 0) {
        setEditingLine(lineIndex - 1);
      } else if (e.key === 'ArrowDown' && lineIndex < lines.length - 1) {
        setEditingLine(lineIndex + 1);
      }

      onKeyDown?.(e);
    },
    [lines, onChange, onKeyDown]
  );

  const handleContainerBlur = useCallback(
    (e: React.FocusEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.relatedTarget as Node)) {
        setEditingLine(null);
        onBlur?.();
      }
    },
    [onBlur]
  );

  const handleLineClick = useCallback(
    (lineIndex: number, e: React.MouseEvent) => {
      e.stopPropagation();
      setEditingLine(lineIndex);
    },
    []
  );

  if (!value && editingLine === null) {
    return (
      <div
        className={className}
        onClick={() => setEditingLine(0)}
        style={{ cursor: 'text' }}
      >
        <span className="text-muted-foreground/40 text-sm">{placeholder}</span>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={className}
      onBlur={handleContainerBlur}
      onClick={(e) => {
        if (e.target === containerRef.current) {
          setEditingLine(lines.length - 1);
        }
      }}
    >
      <div className="space-y-0">
        {lines.map((line, idx) => {
          const isEditingThis = editingLine === idx;

          if (isEditingThis) {
            return (
              <input
                key={idx}
                ref={(el) => {
                  if (el) inputRefs.current.set(idx, el);
                  else inputRefs.current.delete(idx);
                }}
                type="text"
                value={line}
                onChange={(e) => updateLine(idx, e.target.value)}
                onKeyDown={(e) => handleLineKeyDown(e, idx)}
                onClick={(e) => e.stopPropagation()}
                className="w-full bg-transparent border-0 outline-none text-sm text-foreground/60 p-0 leading-relaxed"
                style={{ caretColor: 'hsl(var(--primary))' }}
                placeholder={idx === 0 && !value ? placeholder : ''}
              />
            );
          }

          return (
            <RenderedLine
              key={idx}
              line={line}
              lineIndex={idx}
              onClick={handleLineClick}
              onTimestampClick={onTimestampClick}
            />
          );
        })}
      </div>
    </div>
  );
}

function RenderedLine({
  line,
  lineIndex,
  onClick,
  onTimestampClick,
}: {
  line: string;
  lineIndex: number;
  onClick: (lineIndex: number, e: React.MouseEvent) => void;
  onTimestampClick?: (url: string) => void;
}) {
  if (!line) {
    return (
      <div
        className="min-h-[1.625rem] cursor-text"
        onClick={(e) => onClick(lineIndex, e)}
      >
        &nbsp;
      </div>
    );
  }

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  const regex = new RegExp(TIMESTAMP_REGEX_SOURCE, 'g');
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      parts.push(
        <span key={`t-${lastIndex}`} className="cursor-text" onClick={(e) => onClick(lineIndex, e)}>
          {line.slice(lastIndex, match.index)}
        </span>
      );
    }

    const label = match[1];
    const url = match[2];
    const isYT = url.includes('youtube.com') || url.includes('youtu.be');
    const isTimestamp = isYT && /[?&]t=\d+/.test(url);

    if (isTimestamp) {
      parts.push(
        <button
          key={`c-${match.index}`}
          onClick={(e) => {
            e.stopPropagation();
            onTimestampClick?.(url);
          }}
          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
        >
          {label}
          <Play className="w-2.5 h-2.5" />
        </button>
      );
    } else {
      parts.push(
        <a
          key={`l-${match.index}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {label}
        </a>
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < line.length) {
    parts.push(
      <span key="t-end" className="cursor-text" onClick={(e) => onClick(lineIndex, e)}>
        {line.slice(lastIndex)}
      </span>
    );
  }

  if (parts.length === 0) {
    parts.push(
      <span key="full" className="cursor-text" onClick={(e) => onClick(lineIndex, e)}>
        {line}
      </span>
    );
  }

  return (
    <div className="whitespace-pre-wrap text-sm text-foreground/60 leading-relaxed min-h-[1.625rem]">
      {parts}
    </div>
  );
}
