/**
 * URL normalization for duplicate detection.
 * Strips tracking parameters and normalizes YouTube URL variants
 * so that the same content always produces the same canonical URL.
 */

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
]);

const GENERIC_TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'ref', 'source', 'mc_cid', 'mc_eid',
]);

function extractYouTubeVideoId(url: URL): string | null {
  const host = url.hostname.replace(/^www\./, '');

  if (host === 'youtu.be') {
    const id = url.pathname.slice(1).split('/')[0];
    return id || null;
  }

  if (!YOUTUBE_HOSTS.has(url.hostname) && !YOUTUBE_HOSTS.has(host)) {
    return null;
  }

  // /shorts/{id}
  const shortsMatch = url.pathname.match(/^\/shorts\/([^/?#]+)/);
  if (shortsMatch) return shortsMatch[1];

  // /watch?v={id}
  const v = url.searchParams.get('v');
  if (v) return v;

  // /embed/{id}
  const embedMatch = url.pathname.match(/^\/embed\/([^/?#]+)/);
  if (embedMatch) return embedMatch[1];

  return null;
}

/**
 * Normalize a URL to its canonical form for duplicate detection.
 *
 * YouTube URLs: extracts video ID and produces canonical form.
 * YouTube Shorts: preserves as shorts URL.
 * Other URLs: removes tracking params, sorts remaining params, lowercases hostname.
 */
export function normalizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url; // Return as-is if unparseable
  }

  const host = parsed.hostname.replace(/^www\./, '');
  const isYouTube = YOUTUBE_HOSTS.has(parsed.hostname) || YOUTUBE_HOSTS.has(host) || host === 'youtu.be';

  if (isYouTube) {
    const videoId = extractYouTubeVideoId(parsed);
    if (!videoId) return url;

    // Preserve shorts format
    const isShortsUrl = parsed.pathname.startsWith('/shorts/');
    if (isShortsUrl) {
      return `https://www.youtube.com/shorts/${videoId}`;
    }

    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  // Generic URL normalization
  parsed.hostname = parsed.hostname.toLowerCase();

  // Remove tracking params
  for (const param of GENERIC_TRACKING_PARAMS) {
    parsed.searchParams.delete(param);
  }

  // Sort remaining params for consistency
  parsed.searchParams.sort();

  // Remove trailing slash from pathname
  if (parsed.pathname.endsWith('/') && parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  // Remove hash fragment
  parsed.hash = '';

  return parsed.toString();
}
