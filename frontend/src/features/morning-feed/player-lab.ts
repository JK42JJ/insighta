/*
 * Player lab (/morning-cards/player-lab): pure helpers, unit tested. The page is a device test
 * for the watch screen's player questions (controls=0, sound from our button vs YouTube's, sound
 * kept across a video swap, unmute-and-play after a tap paused the video). No server calls.
 */

/** Public videos already in the stg pool (2026-11-13), used when `?v=` is absent. */
export const LAB_DEFAULT_VIDEOS: readonly string[] = Object.freeze([
  'gNv7MXP6KVs',
  'PxPyqLSa3Sw',
  'hZcI0Tpfko4',
]);

const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const LAB_MAX_VIDEOS = 5;

/** `?v=a,b,c` -> valid 11-character ids (at most 5); none valid -> the defaults. */
export function parseLabVideos(value: string | null): string[] {
  const ids = (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => VIDEO_ID_RE.test(s))
    .slice(0, LAB_MAX_VIDEOS);
  return ids.length > 0 ? ids : [...LAB_DEFAULT_VIDEOS];
}

/** `?controls=0` turns the YouTube controls off; anything else keeps them (1). */
export function parseLabControls(value: string | null): 0 | 1 {
  return value === '0' ? 0 : 1;
}

/** YT.PlayerState names for the log. */
const STATE_NAMES: Record<number, string> = {
  [-1]: 'unstarted',
  0: 'ended',
  1: 'playing',
  2: 'paused',
  3: 'buffering',
  5: 'cued',
};

export function stateName(s: number): string {
  return STATE_NAMES[s] ?? 'state ' + s;
}

/** Seconds since the page opened, one decimal: '12.3s'. */
export function stampText(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(1) + 's';
}
