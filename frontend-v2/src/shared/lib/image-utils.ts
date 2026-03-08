const PROXY_WIDTHS = [320, 480, 720] as const;

function isYouTubeThumbnail(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.hostname === 'img.youtube.com' || parsed.hostname === 'i.ytimg.com';
  } catch {
    return false;
  }
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
