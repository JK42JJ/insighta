const PROXY_WIDTHS = [320, 480, 720] as const;

const YT_THUMB_HOSTS = ['img.youtube.com', 'i.ytimg.com'];
const YT_THUMB_QUALITIES = ['default', 'mqdefault', 'hqdefault', 'sddefault', 'maxresdefault'];

function isYouTubeThumbnail(url: string): boolean {
  try {
    const parsed = new URL(url);
    return YT_THUMB_HOSTS.includes(parsed.hostname);
  } catch {
    return false;
  }
}

/**
 * Upgrade YouTube thumbnail URL to maxresdefault (1280×720) for Retina displays.
 * Returns original URL for non-YouTube thumbnails.
 */
export function upgradeYouTubeThumbnail(url: string | undefined): string | undefined {
  if (!url || !isYouTubeThumbnail(url)) return url;
  const pattern = new RegExp(`/(${YT_THUMB_QUALITIES.join('|')})\\.jpg`);
  return url.replace(pattern, '/maxresdefault.jpg');
}

/**
 * Get the hqdefault fallback URL for a YouTube thumbnail.
 */
export function getYouTubeFallback(url: string | undefined): string | undefined {
  if (!url || !isYouTubeThumbnail(url)) return url;
  const pattern = new RegExp(`/(${YT_THUMB_QUALITIES.join('|')})\\.jpg`);
  return url.replace(pattern, '/hqdefault.jpg');
}

const YT_FALLBACK_CHAIN = ['maxresdefault', 'sddefault', 'hqdefault', 'mqdefault', 'default'];

/**
 * YouTube returns a 120×90 grey "..." placeholder (HTTP 200, not 404) for
 * deleted / private / region-blocked videos. Detect by the exact dimensions
 * — the canonical quality tiers are all wider than 120px for real thumbs.
 */
const YT_PLACEHOLDER_WIDTH = 120;
const YT_PLACEHOLDER_HEIGHT = 90;
export function isYouTubePlaceholder(img: HTMLImageElement): boolean {
  return img.naturalWidth === YT_PLACEHOLDER_WIDTH && img.naturalHeight === YT_PLACEHOLDER_HEIGHT;
}

/**
 * onError handler: walks the full YouTube quality chain, then falls back to local placeholder.
 */
export function handleThumbnailError(e: { currentTarget: HTMLImageElement }): void {
  const img = e.currentTarget;
  const src = img.src;

  // YouTube thumbnail — try next quality level
  const currentIdx = YT_FALLBACK_CHAIN.findIndex((q) => src.includes(q));
  if (currentIdx >= 0 && currentIdx < YT_FALLBACK_CHAIN.length - 1) {
    const next = YT_FALLBACK_CHAIN[currentIdx + 1];
    img.src = src.replace(YT_FALLBACK_CHAIN[currentIdx], next);
    return;
  }

  // All YouTube qualities exhausted or non-YouTube image — local placeholder
  img.src = '/placeholder.svg';
}

/**
 * onLoad handler: when a 120×90 grey image loads successfully, walk down
 * the quality chain first — older videos often lack `maxresdefault` /
 * `sddefault` and YouTube substitutes that placeholder even when the
 * video itself is fine. Only after exhausting the chain do we give up
 * and use the local placeholder (true "video unavailable" case).
 */
export function handleThumbnailLoad(e: { currentTarget: HTMLImageElement }): void {
  const img = e.currentTarget;
  if (img.src.endsWith('/placeholder.svg')) return;
  if (!isYouTubePlaceholder(img)) return;

  const src = img.src;
  const currentIdx = YT_FALLBACK_CHAIN.findIndex((q) => src.includes(q));
  if (currentIdx >= 0 && currentIdx < YT_FALLBACK_CHAIN.length - 1) {
    const next = YT_FALLBACK_CHAIN[currentIdx + 1];
    img.src = src.replace(YT_FALLBACK_CHAIN[currentIdx], next);
    return;
  }

  img.src = '/placeholder.svg';
}

/**
 * Bundled error + load handlers for any <img> that may render a YouTube
 * thumbnail. Spread into the element: `<img src={...} {...thumbnailImgHandlers} />`.
 */
export const thumbnailImgHandlers = {
  onError: handleThumbnailError,
  onLoad: handleThumbnailLoad,
} as const;

export function generateThumbnailSrcSet(thumbnailUrl: string | undefined): string | undefined {
  if (!thumbnailUrl || !isYouTubeThumbnail(thumbnailUrl)) return undefined;

  return PROXY_WIDTHS.map(
    (w) => `/api/v1/images/proxy?url=${encodeURIComponent(thumbnailUrl)}&w=${w}&format=webp ${w}w`
  ).join(', ');
}

export function generateProxySrc(
  thumbnailUrl: string | undefined,
  width = 480
): string | undefined {
  if (!thumbnailUrl || !isYouTubeThumbnail(thumbnailUrl)) return undefined;

  return `/api/v1/images/proxy?url=${encodeURIComponent(thumbnailUrl)}&w=${width}&format=webp`;
}

export const DEFAULT_SIZES = '(max-width: 480px) 320px, (max-width: 768px) 480px, 720px';
