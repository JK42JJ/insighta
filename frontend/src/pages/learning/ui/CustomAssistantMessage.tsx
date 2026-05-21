/**
 * CustomAssistantMessage — CP477+10.
 *
 * Re-implements CopilotKit's default `AssistantMessage` and adds a 5th
 * control button ("메모에 추가") next to the existing regenerate / copy /
 * thumbs-up / thumbs-down icons. The button calls `appendToNote(text)`
 * from `noteEditorBridge`, which targets the TipTap editor instance
 * registered by `PanelNoteEditor`.
 *
 * Why not DOM injection: the CopilotKit `<CopilotChat>` component
 * accepts an `AssistantMessage` prop precisely for this case
 * (extending the message UI with custom actions). Adding the button
 * via React render rather than MutationObserver gives us:
 *   - The button sits in the same `.copilotKitMessageControls` row as
 *     the other icons (correct visual placement).
 *   - The click handler holds the React `appendToNote` reference
 *     directly (no DOM event delegation, no stale-closure risk).
 *   - Streaming-aware: the `isLoading` flag from CopilotKit gates
 *     the controls just like the default component.
 *
 * Source pattern mirrors
 * `@copilotkit/react-ui/src/components/chat/messages/AssistantMessage.tsx`
 * at version 1.55.3 / 1.56.3 (identical signature between the two).
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { NotebookPen } from 'lucide-react';
import { Markdown, useChatContext, type AssistantMessageProps } from '@copilotkit/react-ui';
// CP477+10+1 — @copilotkit/shared@1.55.3 does not export `copyToClipboard`
// (added only in 1.56.x). Use the browser standard `navigator.clipboard.writeText`
// directly so this works on both 1.55.x and 1.56.x.

import { appendToNote } from '@/pages/learning/model/noteEditorBridge';

export interface CustomAssistantMessageProps extends AssistantMessageProps {
  /** YouTube videoId used to turn message timestamps into clickable links
   *  inside the note when the user clicks "메모에 추가". */
  videoId?: string;
}

export function CustomAssistantMessage(props: CustomAssistantMessageProps) {
  const { icons, labels } = useChatContext();
  const {
    message,
    isLoading,
    onRegenerate,
    onCopy,
    onThumbsUp,
    onThumbsDown,
    isCurrentMessage,
    feedback,
    markdownTagRenderers,
  } = props;
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async (): Promise<void> => {
    const content = message?.content || '';
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      if (onCopy) onCopy(content);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard write blocked (permissions / iframe / http context) — silent fail
    }
  };

  const handleAddToNote = (): void => {
    const content = (message?.content || '').trim();
    if (!content) {
      toast.error(t('learning.addToNoteFailed'));
      return;
    }
    // CP477+10 — pass videoId so timestamps in the message body become
    // clickable YouTube links inside the note (e.g. "5:10" → seek to 310s).
    const ok = appendToNote(content, props.videoId);
    if (ok) {
      toast.success(t('learning.addToNoteSuccess'));
    } else {
      toast.error(t('learning.addToNoteFailed'));
    }
  };

  const LoadingIcon = (): JSX.Element => <span>{icons.activityIcon}</span>;
  const content = message?.content || '';
  // CopilotKit AssistantMessage supports inline rendered components (generativeUI).
  // We preserve that behaviour exactly as the default implementation.
  const subComponent = (message as { generativeUI?: () => React.ReactNode })?.generativeUI?.();
  const subComponentPosition =
    (message as { generativeUIPosition?: 'before' | 'after' })?.generativeUIPosition ?? 'after';
  const renderBefore = subComponent && subComponentPosition === 'before';
  const renderAfter = subComponent && subComponentPosition !== 'before';

  return (
    <>
      {renderBefore ? <div style={{ marginBottom: '0.5rem' }}>{subComponent}</div> : null}
      {content && (
        <div className="copilotKitMessage copilotKitAssistantMessage">
          {content && <Markdown content={content} components={markdownTagRenderers} />}

          {content && !isLoading && (
            <div
              className={`copilotKitMessageControls ${isCurrentMessage ? 'currentMessage' : ''}`}
            >
              <button
                className="copilotKitMessageControlButton"
                onClick={() => onRegenerate?.()}
                aria-label={labels.regenerateResponse}
                title={labels.regenerateResponse}
              >
                {icons.regenerateIcon}
              </button>
              <button
                className="copilotKitMessageControlButton"
                onClick={handleCopy}
                aria-label={labels.copyToClipboard}
                title={labels.copyToClipboard}
              >
                {copied ? (
                  <span style={{ fontSize: '10px', fontWeight: 'bold' }}>✓</span>
                ) : (
                  icons.copyIcon
                )}
              </button>
              {onThumbsUp && (
                <button
                  className={`copilotKitMessageControlButton ${
                    feedback === 'thumbsUp' ? 'active' : ''
                  }`}
                  onClick={() => message && onThumbsUp(message)}
                  aria-label={labels.thumbsUp}
                  title={labels.thumbsUp}
                >
                  {icons.thumbsUpIcon}
                </button>
              )}
              {onThumbsDown && (
                <button
                  className={`copilotKitMessageControlButton ${
                    feedback === 'thumbsDown' ? 'active' : ''
                  }`}
                  onClick={() => message && onThumbsDown(message)}
                  aria-label={labels.thumbsDown}
                  title={labels.thumbsDown}
                >
                  {icons.thumbsDownIcon}
                </button>
              )}
              <button
                className="copilotKitMessageControlButton"
                onClick={handleAddToNote}
                aria-label={t('learning.addToNote')}
                title={t('learning.addToNote')}
              >
                <NotebookPen size={14} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      )}
      {renderAfter ? <div style={{ marginBottom: '0.5rem' }}>{subComponent}</div> : null}
      {isLoading && <LoadingIcon />}
    </>
  );
}
