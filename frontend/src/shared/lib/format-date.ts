/**
 * YouTube-style relative date formatting.
 * Accepts Date, ISO string, or null/undefined (returns null).
 */
export function formatRelativeDate(date: Date | string | null | undefined): string | null {
  if (!date) return null;
  const ms = Date.now() - new Date(date).getTime();
  if (ms < 0 || isNaN(ms)) return null;

  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes === 1) return '1 minute ago';
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  if (days === 1) return '1 day ago';
  if (days < 7) return `${days} days ago`;

  const weeks = Math.floor(days / 7);
  if (weeks === 1) return '1 week ago';
  if (weeks < 5) return `${weeks} weeks ago`;

  const months = Math.floor(days / 30);
  if (months === 1) return '1 month ago';
  if (months < 12) return `${months} months ago`;

  const years = Math.floor(days / 365);
  if (years === 1) return '1 year ago';
  return `${years} years ago`;
}

/**
 * Honest card date label (#published_at contamination fix).
 * - publishedAt present  → "N months ago"        (actual YouTube publish date)
 * - publishedAt missing  → "added N days ago"    (when the card was added —
 *   NEVER disguised as a publish date; prior code fell back silently and a
 *   contaminated/absent publish date rendered as a fake "2 months ago")
 * - neither              → null (slot stays empty)
 */
export function formatCardDateLabel(
  publishedAt: Date | string | null | undefined,
  createdAt: Date | string | null | undefined
): string | null {
  const published = formatRelativeDate(publishedAt);
  if (published) return published;
  const added = formatRelativeDate(createdAt);
  return added ? `added ${added}` : null;
}
