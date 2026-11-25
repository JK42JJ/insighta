import { useRef, useState, type CSSProperties, type FormEvent } from 'react';

import { postAppFeedback, type AppFeedbackWhere } from '@/features/morning-cards/api';
import { feedbackPath } from '@/features/morning-feed/feedback-path';
import { useKeyboardInset } from '@/features/morning-feed/use-keyboard-inset';
import { getReplayUrl } from '@/shared/lib/posthog';
import { toast } from '@/shared/ui/sonner';

/*
 * 제안하기 (work order B4, 2026-11-25): one line and 보내기, inside the account sheet. It sends
 * where the person was and, when a session recording is running, its address. A comment that could
 * not be saved stays in the field.
 */

export const SUGGEST_LABEL = '제안하기';
export const SUGGEST_GUIDE = '불편하거나 바라는 점을 한 줄로 남겨 주세요.';
export const SUGGEST_THANKS = '고마워요. 잘 반영할게요.';
const SUGGEST_FAILED = '저장하지 못했습니다';
/** Same as the server's APP_FEEDBACK_BODY_MAX (src/modules/morning-feed/app-feedback.ts). */
const SUGGEST_MAX = 2000;

export function SuggestForm({
  where,
  onSent,
}: {
  where: AppFeedbackWhere;
  /** Saved: the sheet's own close. */
  onSent: () => void;
}): JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const keyboard = useKeyboardInset(form);
  const empty = text.trim() === '';

  const send = (): void => {
    if (empty || busy) return;
    setBusy(true);
    setFailed(false);
    postAppFeedback({
      kind: 'menu',
      body: text.trim(),
      path: feedbackPath(window.location),
      replayUrl: getReplayUrl(),
      ...where,
    })
      .then(() => {
        toast(SUGGEST_THANKS);
        onSent();
      })
      .catch(() => {
        setFailed(true);
        setBusy(false);
      });
  };

  return (
    <form
      ref={form}
      className="mf-suggest-form"
      data-testid="mf-suggest"
      style={{ '--mf-kb': keyboard + 'px' } as CSSProperties}
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        send();
      }}
    >
      <label className="mf-suggest-guide" htmlFor="mf-suggest-input">
        {SUGGEST_GUIDE}
      </label>
      <div className="mf-suggest-row">
        <input
          id="mf-suggest-input"
          className="mf-suggest-input"
          data-testid="mf-suggest-input"
          data-selectable=""
          type="text"
          autoComplete="off"
          enterKeyHint="send"
          maxLength={SUGGEST_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          // Enter that only ends a Korean composition is not a send
          onKeyDown={(e) => {
            if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
          }}
          // the sheet's drag must not take the touch that places the caret
          onPointerDown={(e) => e.stopPropagation()}
        />
        <button
          type="submit"
          className="mf-suggest-send"
          data-press="row"
          data-testid="mf-suggest-send"
          disabled={empty || busy}
        >
          보내기
        </button>
      </div>
      {failed ? (
        <div className="mf-suggest-err" role="status" data-testid="mf-suggest-error">
          {SUGGEST_FAILED}
        </div>
      ) : null}
    </form>
  );
}
