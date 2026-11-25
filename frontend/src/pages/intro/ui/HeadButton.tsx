import { useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';

/** A press that moves further than this is not a press any more (px). */
export const PRESS_CANCEL_PX = 10;

/*
 * A text button of the landing's header ("Insighta", "로그인"): a 44px target with a soft round
 * ground that is there at the touch and fades after it (James 2026-11-25). The state is set by the
 * pointer events themselves (:active alone does not show on an iPhone). A gesture that starts here
 * never turns the page: the stage does not get the pointer.
 */
export function HeadButton({
  children,
  label,
  className,
  dark,
  onPress,
  testId,
  style,
  hidden = false,
}: {
  /** What is drawn when it is not the label itself (the logo). */
  children?: ReactNode;
  label: string;
  className: string;
  /** On the dark scenes. */
  dark: boolean;
  onPress: () => void;
  testId: string | undefined;
  style?: CSSProperties;
  hidden?: boolean;
}): JSX.Element {
  const [pressed, setPressed] = useState(false);
  const from = useRef<{ id: number; x: number; y: number } | null>(null);
  const cancelled = useRef(false);

  const onPointerDown = (e: PointerEvent): void => {
    e.stopPropagation();
    if (from.current) return;
    from.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    cancelled.current = false;
    setPressed(true);
  };
  const onPointerMove = (e: PointerEvent): void => {
    const f = from.current;
    if (!f || e.pointerId !== f.id) return;
    e.stopPropagation();
    if (Math.hypot(e.clientX - f.x, e.clientY - f.y) < PRESS_CANCEL_PX) return;
    cancelled.current = true;
    setPressed(false);
  };
  const release = (e: PointerEvent): void => {
    if (!from.current || e.pointerId !== from.current.id) return;
    e.stopPropagation();
    if (e.type !== 'pointerup') cancelled.current = true;
    from.current = null;
    setPressed(false);
  };

  return (
    <button
      type="button"
      className={`lv-headbtn ${className}`}
      data-testid={testId}
      data-pressed={pressed ? '' : undefined}
      data-dark={dark ? '' : undefined}
      aria-label={children ? label : undefined}
      aria-hidden={hidden ? true : undefined}
      tabIndex={hidden ? -1 : undefined}
      style={{ ...style, pointerEvents: hidden ? 'none' : 'auto' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={release}
      onPointerCancel={release}
      onPointerLeave={release}
      onClick={(e) => {
        e.stopPropagation();
        // a keyboard press has no pointer before it
        if (e.detail !== 0 && cancelled.current) return;
        onPress();
      }}
    >
      <span>{children ?? label}</span>
    </button>
  );
}
