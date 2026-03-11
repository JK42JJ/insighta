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
 * onError handler: walks the full YouTube quality chain, then falls back to local placeholder.
 */
export function handleThumbnailError(e: { currentTarget: HTMLImageElement }): void {
  const img = e.currentTarget;
  const src = img.src;

  // YouTube thumbnail — try next quality level
  const currentIdx = YT_FALLBACK_CHAIN.findIndex(q => src.includes(q));
  if (currentIdx >= 0 && currentIdx < YT_FALLBACK_CHAIN.length - 1) {
    const next = YT_FALLBACK_CHAIN[currentIdx + 1];
    img.src = src.replace(YT_FALLBACK_CHAIN[currentIdx], next);
    return;
  }

  // All YouTube qualities exhausted or non-YouTube image — local placeholder
  img.src = '/placeholder.svg';
}

export function generateThumbnailSrcSet(thumbnailUrl: string | undefined): string | undefined {
  if (!thumbnailUrl || !isYouTubeThumbnail(thumbnailUrl)) return undefined;

  return PROXY_WIDTHS.map(
    (w) => `/api/v1/images/proxy?url=${encodeURIComponent(thumbnailUrl)}&w=${w}&format=webp ${w}w`
  ).join(', ');
}

export function generateProxySrc(thumbnailUrl: string | undefined, width = 480): string | undefined {
  if (!thumbnailUrl || !isYouTubeThumbnail(thumbnailUrl)) return undefined;

  return `/api/v1/images/proxy?url=${encodeURIComponent(thumbnailUrl)}&w=${width}&format=webp`;
}

export const DEFAULT_SIZES = '(max-width: 480px) 320px, (max-width: 768px) 480px, 720px';
