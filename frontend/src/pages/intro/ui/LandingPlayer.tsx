import { useEffect, useRef, type SyntheticEvent } from 'react';

import { CLOSE_LABEL, YT_CREDIT } from '../model/landing-content';
import { embedUrl, type PlayTarget } from '../model/landing-example';

/*
 * A video played on the landing itself (James 2026-11-25: a tap must never leave Insighta). The
 * embedded YouTube player takes the full width (16:9, at least 200px high on every phone, YouTube
 * Required Minimum Functionality); nothing is drawn over it: the close button and the titles are
 * above and below. Touches here are not swipes of the scenes.
 */
export function LandingPlayer({
  target,
  onClose,
}: {
  target: PlayTarget;
  onClose: () => void;
}): JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
  }, []);
  const keep = (e: SyntheticEvent): void => e.stopPropagation();
  return (
    <div
      className="lv-player"
      role="dialog"
      aria-modal="true"
      aria-label={target.video.title}
      data-testid="lv-player"
      onPointerDown={keep}
      onPointerMove={keep}
      onPointerUp={keep}
      onWheel={keep}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="lv-player-head">
        <button
          ref={closeRef}
          type="button"
          className="lv-player-close"
          data-testid="lv-player-close"
          onClick={onClose}
        >
          {CLOSE_LABEL}
        </button>
      </div>
      <iframe
        className="lv-player-frame"
        data-testid="lv-player-frame"
        src={embedUrl(target)}
        title={target.video.title}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
      />
      <div className="lv-player-text">
        <p className="lv-player-title">{target.video.title}</p>
        <p className="lv-player-sub">
          {target.video.channel} · {YT_CREDIT}
        </p>
      </div>
    </div>
  );
}
