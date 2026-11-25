/*
 * Shares a brief (order 2026-11-25 B8): the headline and its address through the system's share
 * sheet; where there is none, the link is copied.
 */

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

export async function shareBrief(headline: string, url: string): Promise<ShareResult> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: headline, text: headline, url });
      return 'shared';
    } catch (e) {
      // closed by the person: nothing else happens
      if (e instanceof Error && e.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(headline + '\n' + url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
