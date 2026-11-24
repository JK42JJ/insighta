/**
 * Watch screen (stg): the immersive-playback background colour of a video, taken from its
 * thumbnail (design handoff "design_handoff_insighta_watch_v2" README §5).
 *
 * Method: the thumbnail is shrunk to 64×36, each pixel is weighted by the square of its HSV
 * saturation, the weighted mean is multiplied by AMBIENT_FACTOR, and the result is darkened
 * further when its HSL lightness is above AMBIENT_MAX_LIGHTNESS (white text must stay readable).
 * Checked against the two handoff examples (#201E32, #2B2419): within 4 per channel.
 *
 * Only YouTube thumbnail hosts are fetched (no other URL is ever requested). Results are cached in
 * memory for at most AMBIENT_CACHE_TTL_MS (YouTube API Services Developer Policies III.E.4: API
 * data is deleted or refreshed within 30 days). A failure gives null: the screen then uses Ink
 * Navy, as the README says.
 */
import sharp from 'sharp';

import { MS_PER_DAY, MS_PER_MINUTE } from '@/utils/time-constants';

const SAMPLE_WIDTH = 64;
const SAMPLE_HEIGHT = 36;
/** README: "그 색에 0.5~0.55를 곱해 어둡게". */
export const AMBIENT_FACTOR = 0.53;
/** README: "밝기는 약 20% 이하". */
export const AMBIENT_MAX_LIGHTNESS = 0.2;
const CHANNEL_MAX = 255;
const HEX_RADIX = 16;
const HEX_DIGITS = 2;

export const AMBIENT_FETCH_TIMEOUT_MS = 1500;
const AMBIENT_MAX_BYTES = 512 * 1024;
const DAYS_IN_CACHE = 30;
export const AMBIENT_CACHE_TTL_MS = DAYS_IN_CACHE * MS_PER_DAY;
const AMBIENT_CACHE_MAX = 5000;
/** A failed thumbnail is retried after this long instead of staying on Ink Navy for 30 days. */
const FAIL_MINUTES = 10;
export const AMBIENT_FAIL_TTL_MS = FAIL_MINUTES * MS_PER_MINUTE;

const THUMB_HOSTS: ReadonlySet<string> = new Set([
  'i.ytimg.com',
  'i1.ytimg.com',
  'i2.ytimg.com',
  'i3.ytimg.com',
  'i4.ytimg.com',
  'i9.ytimg.com',
  'img.youtube.com',
]);

/** True only for an https URL on a YouTube thumbnail host. */
export function isYouTubeThumbUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && THUMB_HOSTS.has(u.hostname);
  } catch {
    return false;
  }
}

function hex(c: number): string {
  return Math.round(Math.min(CHANNEL_MAX, Math.max(0, c)))
    .toString(HEX_RADIX)
    .padStart(HEX_DIGITS, '0');
}

/**
 * The ambient colour of raw RGB(A) pixels as '#rrggbb'. Pure, so it is unit tested. All-grey
 * pixels (no saturation anywhere) fall back to the plain mean.
 */
export function ambientFromPixels(data: Uint8Array, channels: number): string {
  let r = 0;
  let g = 0;
  let b = 0;
  let w = 0;
  let pr = 0;
  let pg = 0;
  let pb = 0;
  let n = 0;
  for (let i = 0; i + 2 < data.length; i += channels) {
    const R = data[i] ?? 0;
    const G = data[i + 1] ?? 0;
    const B = data[i + 2] ?? 0;
    const mx = Math.max(R, G, B);
    const mn = Math.min(R, G, B);
    const s = mx === 0 ? 0 : (mx - mn) / mx;
    const k = s * s;
    r += R * k;
    g += G * k;
    b += B * k;
    w += k;
    pr += R;
    pg += G;
    pb += B;
    n += 1;
  }
  if (n === 0) return '#000000';
  let c = w > 0 ? [r / w, g / w, b / w] : [pr / n, pg / n, pb / n];
  c = c.map((x) => x * AMBIENT_FACTOR);
  const lightness = (Math.max(...c) + Math.min(...c)) / 2 / CHANNEL_MAX;
  if (lightness > AMBIENT_MAX_LIGHTNESS) c = c.map((x) => (x * AMBIENT_MAX_LIGHTNESS) / lightness);
  return '#' + c.map(hex).join('');
}

/** The ambient colour of an encoded image (JPEG/PNG/WebP). */
export async function ambientFromImage(buf: Buffer): Promise<string> {
  const { data, info } = await sharp(buf)
    .resize(SAMPLE_WIDTH, SAMPLE_HEIGHT, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return ambientFromPixels(data, info.channels);
}

export type ThumbFetcher = (url: string, signal: AbortSignal) => Promise<Buffer>;

const defaultFetcher: ThumbFetcher = async (url, signal) => {
  const res = await fetch(url, { signal, redirect: 'error' });
  if (!res.ok) throw new Error('thumbnail ' + res.status);
  const len = Number(res.headers.get('content-length') ?? 0);
  if (len > AMBIENT_MAX_BYTES) throw new Error('thumbnail too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > AMBIENT_MAX_BYTES) throw new Error('thumbnail too large');
  return buf;
};

interface CacheEntry {
  color: string | null;
  at: number;
}

/** In-memory cache: insertion order = age, the oldest entry is dropped at the cap. */
export class AmbientCache {
  private readonly map = new Map<string, CacheEntry>();
  constructor(
    private readonly ttlMs: number = AMBIENT_CACHE_TTL_MS,
    private readonly max: number = AMBIENT_CACHE_MAX,
    private readonly failTtlMs: number = AMBIENT_FAIL_TTL_MS
  ) {}
  get(key: string, now: number): CacheEntry | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (now - e.at > (e.color === null ? this.failTtlMs : this.ttlMs)) {
      this.map.delete(key);
      return undefined;
    }
    return e;
  }
  set(key: string, color: string | null, now: number): void {
    this.map.delete(key);
    this.map.set(key, { color, at: now });
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
  get size(): number {
    return this.map.size;
  }
}

const sharedCache = new AmbientCache();

export interface AmbientDeps {
  fetcher?: ThumbFetcher;
  cache?: AmbientCache;
  now?: () => number;
  timeoutMs?: number;
}

/** The ambient colour of one thumbnail URL, or null (not a YouTube thumbnail, fetch or decode failed). */
export async function ambientForThumb(
  url: string | null | undefined,
  deps: AmbientDeps = {}
): Promise<string | null> {
  if (!isYouTubeThumbUrl(url)) return null;
  const cache = deps.cache ?? sharedCache;
  const now = deps.now ?? Date.now;
  const hit = cache.get(url, now());
  if (hit) return hit.color;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), deps.timeoutMs ?? AMBIENT_FETCH_TIMEOUT_MS);
  let color: string | null = null;
  try {
    color = await ambientFromImage(await (deps.fetcher ?? defaultFetcher)(url, ctrl.signal));
  } catch {
    color = null;
  } finally {
    clearTimeout(timer);
  }
  cache.set(url, color, now());
  return color;
}

/** Cards with `ambient` added (null when it could not be computed), fetched in parallel. */
export async function withAmbient<T extends { thumbnail_url: string | null }>(
  items: readonly T[],
  deps: AmbientDeps = {}
): Promise<Array<T & { ambient: string | null }>> {
  const colors = await Promise.all(items.map((it) => ambientForThumb(it.thumbnail_url, deps)));
  return items.map((it, i) => ({ ...it, ambient: colors[i] ?? null }));
}
