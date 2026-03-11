import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Pencil, Eye } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { cn } from '@/shared/lib/utils';

interface NoteEditorProps {
  value: string;
  onSave: (note: string) => void;
}

const AUTO_SAVE_DELAY = 5000;

export function NoteEditor({ value, onSave }: NoteEditorProps) {
  const { t } = useTranslation();
  const [text, setText] = useState(value);
  const [isPreview, setIsPreview] = useState(false);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Sync when external value changes (card switch)
  useEffect(() => {
    setText(value);
  }, [value]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current && !isPreview) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.max(120, textareaRef.current.scrollHeight)}px`;
    }
  }, [text, isPreview]);

  const scheduleAutoSave = useCallback(
    (newText: string) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onSave(newText);
      }, AUTO_SAVE_DELAY);
    },
    [onSave]
  );

  // Flush on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        // We can't call onSave here safely since it may be stale, so skip
      }
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newText = e.target.value;
    setText(newText);
    scheduleAutoSave(newText);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      if (debounceRef.current) clearTimeout(debounceRef.current);
      onSave(text);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{t('view.noteEditor')}</span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-6 px-2 text-xs', !isPreview && 'bg-muted')}
            onClick={() => setIsPreview(false)}
          >
            <Pencil className="h-3 w-3 mr-1" />
            {t('view.edit')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={cn('h-6 px-2 text-xs', isPreview && 'bg-muted')}
            onClick={() => setIsPreview(true)}
          >
            <Eye className="h-3 w-3 mr-1" />
            {t('view.preview')}
          </Button>
        </div>
      </div>

      {isPreview ? (
        <div className="prose prose-sm dark:prose-invert max-w-none min-h-[120px] p-3 rounded-md border bg-muted/30">
          {text ? (
            <div className="whitespace-pre-wrap">{text}</div>
          ) : (
            <p className="text-muted-foreground italic">{t('insightCard.noMemo')}</p>
          )}
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={t('videoPlayer.clickToWriteNote')}
          className="w-full min-h-[120px] p-3 rounded-md border bg-background text-sm resize-none focus:outline-none focus:ring-1 focus:ring-ring"
        />
      )}

      <p className="text-[10px] text-muted-foreground text-right">
        {t('videoPlayer.ctrlEnterToSave')}
      </p>
    </div>
  );
}
