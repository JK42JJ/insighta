/**
 * Card validation gate — structural prevention of shell/invalid cards.
 *
 * Applied at ALL card creation entry points (frontend + Edge Function).
 * DB CHECK constraint is the last line of defense (Step 3).
 */

/** Hosts that serve images/thumbnails — never valid as card URLs */
const BLOCKED_HOSTS = [
  'img.youtube.com',
  'i.ytimg.com',
  'i1.ytimg.com',
  'i2.ytimg.com',
  'i3.ytimg.com',
  'i4.ytimg.com',
  'yt3.ggpht.com',
  'lh3.googleusercontent.com',
] as const;

interface CardForValidation {
  url?: string;
  title?: string;
}

interface ValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Validate a card before INSERT. Returns { valid: false, reason } if rejected.
 *
 * Rules:
 * 1. URL is required and must be non-empty
 * 2. URL must not be an image/thumbnail CDN host
 * 3. URL must be a valid URL format
 * 4. Generic titles are warned (not blocked — metadata may populate later)
 */
export function isValidCardForInsert(card: CardForValidation): ValidationResult {
  // 1. URL required
  if (!card.url || !card.url.trim()) {
    return { valid: false, reason: 'URL is empty' };
  }

  // 2. Check against blocked hosts (thumbnail CDNs)
  try {
    const hostname = new URL(card.url).hostname.toLowerCase();
    for (const blocked of BLOCKED_HOSTS) {
      if (hostname === blocked || hostname.endsWith(`.${blocked}`)) {
        return { valid: false, reason: `Blocked host: ${hostname}` };
      }
    }
  } catch {
    return { valid: false, reason: 'Invalid URL format' };
  }

  // 3. Warn on generic placeholder titles (not a hard block)
  const GENERIC_TITLES = ['YouTube Video', 'Untitled', 'undefined', 'null', ''];
  if (!card.title || GENERIC_TITLES.includes(card.title.trim())) {
    console.warn(
      `[card-validation] Generic title detected: "${card.title}" for URL: ${card.url}`
    );
  }

  return { valid: true };
}
