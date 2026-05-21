/**
 * Build outbound share URLs for the learning page share menu (CP454+).
 *
 * Single source of truth for the X / Naver intent URL formats and the
 * 550x420 popup window dimensions. DraggableCard's legacy `handleShareToX`
 * was the original implementation; this util lifts the URL formatting out
 * of the component so CenterPanel (learning page) and DraggableCard can
 * share the same code path.
 */

const POPUP_FEATURES = 'noopener,noreferrer,width=550,height=420';

/** YouTube default thumbnail (hqdefault — 480x360, always exists). */
export function youtubeThumbnailUrl(youtubeVideoId: string): string {
  return `https://i.ytimg.com/vi/${youtubeVideoId}/hqdefault.jpg`;
}

/** X (Twitter) Web Intent — no SDK required. */
export function openXShare({ title, url }: { title: string; url: string }): void {
  const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(title)}&url=${encodeURIComponent(url)}`;
  window.open(intent, '_blank', POPUP_FEATURES);
}

/** Naver share — simple share-view URL pattern, no SDK required. */
export function openNaverShare({ title, url }: { title: string; url: string }): void {
  const intent = `https://share.naver.com/web/shareView?url=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}`;
  window.open(intent, '_blank', POPUP_FEATURES);
}

/**
 * Build the canonical share URL used by ALL channels (links the recipient
 * to a BE-rendered OG meta page that then redirects to the SPA learning
 * page). Phase 5 — backed by the `GET /og/learning/:m/:v` Fastify route.
 *
 * Recipient flow:
 *   1. SNS crawler GET /og/learning/:m/:v → BE returns HTML with og:* meta
 *   2. Recipient's browser GET /og/learning/:m/:v → BE serves the same
 *      HTML which contains <meta http-equiv="refresh"> + JS redirect
 *      → lands on SPA /learning/:m/:v
 */
export function buildShareUrl({
  origin,
  mandalaId,
  videoId,
}: {
  origin: string;
  mandalaId: string;
  videoId: string;
}): string {
  return `${origin}/og/learning/${mandalaId}/${videoId}`;
}

/**
 * X-share payload helper used by DraggableCard (which has card.userNote
 * memo link extraction). Keeps the legacy memo-aware title/url derivation
 * in one place so both DraggableCard and any future memo-aware caller
 * stay aligned.
 */
export function deriveCardShareText(
  cardTitle: string,
  cardVideoUrl: string,
  userNote: string | null | undefined,
  fallbackTitle: string
): { title: string; url: string } {
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/;
  const linkMatch = userNote?.match(linkPattern);

  if (linkMatch) {
    const linkLabel = linkMatch[1];
    const linkUrl = linkMatch[2];
    const memoWithoutLink = userNote!.replace(linkMatch[0], '').trim();
    return {
      title: memoWithoutLink ? `${linkLabel} ${memoWithoutLink}` : linkLabel,
      url: linkUrl,
    };
  }

  return {
    title: cardTitle || fallbackTitle,
    url: cardVideoUrl,
  };
}
