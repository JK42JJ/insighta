import { useLearningStore } from '../model/useLearningStore';

/**
 * Watched-progress bar on the /learning player — the "내가 본 구간" indicator.
 * Same concept as the note-mode video blocks (`.video-block-progress`, James
 * CP512): a thin bar flush along the video's BOTTOM edge — subtle track + a gold
 * (`--nm-accent`) fill that grows with playback. This reads cleaner than floating
 * it at the heatmap baseline (which crowded the native controls).
 *
 * Sibling of PlayerChrome → independent of the relevance-heatmap gate (shows even
 * with no relevance segments). Always visible. `pointer-events-none` (never steals
 * a click). Uses the live position the player already streams to the store.
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
      className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-[3px] overflow-hidden rounded-b-lg bg-white/[0.12]"
      aria-hidden
    >
      {/* Gold fill = the learning chapter accent (--nm-accent #c2a878). */}
      <div
        className="h-full bg-[var(--nm-accent)] transition-[width] duration-500 ease-linear"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
