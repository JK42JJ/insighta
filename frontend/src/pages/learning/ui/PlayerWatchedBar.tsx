import { useLearningStore } from '../model/useLearningStore';
import { STRIP_BOTTOM_PX, STRIP_INSET_PX } from './PlayerChrome';

/**
 * Watched-progress line on the /learning native player — the "내가 본 구간"
 * indicator, in the chapter GOLD (James, CP512). Sibling of PlayerChrome so it
 * is independent of the relevance-heatmap gate (renders even when a video has no
 * relevance segments). Always visible (not hover-only) so progress is readable
 * at a glance. Reads the live player position the player already streams into the
 * store via onTimeUpdate — no extra wiring. pointer-events-none (never steals a
 * click from the native bar / the heatmap strip).
 */
export function PlayerWatchedBar() {
  const playerTimeSec = useLearningStore((s) => s.playerTimeSec);
  const playerDurationSec = useLearningStore((s) => s.playerDurationSec);
  const playerState = useLearningStore((s) => s.playerState);

  const started = playerState === 'playing' || playerTimeSec > 0;
  if (!started || playerDurationSec <= 0) return null;
  const pct = Math.min(100, Math.max(0, (playerTimeSec / playerDurationSec) * 100));

  return (
    <div
      className="pointer-events-none absolute z-30"
      aria-hidden
      style={{ bottom: STRIP_BOTTOM_PX, left: STRIP_INSET_PX, right: STRIP_INSET_PX, height: 3 }}
    >
      <div className="h-full w-full rounded-full bg-black/30">
        {/* Gold = the learning chapter accent (--nm-accent #c2a878). */}
        <div className="h-full rounded-full bg-[var(--nm-accent)]" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
