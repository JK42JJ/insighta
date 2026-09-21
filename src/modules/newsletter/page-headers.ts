/**
 * Response headers for the two surfaces that serve a brief as a standalone
 * page: the published page and the admin preview of a draft.
 *
 * Both go through `sendBriefPage` rather than setting headers of their own, so
 * the preview cannot end up under a different policy than the page it is
 * supposed to be a preview of. That was not a theoretical risk: the template
 * links a Google Fonts stylesheet and asserted in a comment that "Google Fonts
 * is the one host that survives a CSP", and the API's global policy
 * (`style-src 'self' 'unsafe-inline'`, measured on prod 2026-09-21) does not
 * admit it -- so every issue published since 2026-09-02 has rendered in the
 * fallback stack while the comment said otherwise.
 *
 * The policy here is narrower than the global one, not wider. A brief page is
 * inline CSS, text, and anchors: no script, no image, no frame, no form. Naming
 * that in the policy means a template change that adds one is refused until the
 * policy is extended on purpose, and `brief-page-csp.test.ts` fails first.
 */

/** Serves the @font-face rules. Needed in `style-src`, not `font-src`. */
export const FONT_STYLE_HOST = 'https://fonts.googleapis.com';
/** Serves the font files the rules above point at. */
export const FONT_FILE_HOST = 'https://fonts.gstatic.com';

export const BRIEF_PAGE_CSP = [
  // Everything not named below is refused, which is every fetch the page makes.
  "default-src 'none'",
  // The stylesheet is inline except for the webfont import.
  `style-src 'unsafe-inline' ${FONT_STYLE_HOST}`,
  `font-src ${FONT_FILE_HOST}`,
  "base-uri 'none'",
  "form-action 'none'",
  // Same-origin only. The admin preview does not rely on this -- it fetches the
  // HTML with a header and renders it itself -- so this can stay closed.
  "frame-ancestors 'self'",
].join('; ');

/** The subset of a `FastifyReply` this module uses, so it can be tested without one. */
export interface BriefPageReply {
  header(name: string, value: string): BriefPageReply;
  type(contentType: string): BriefPageReply;
  send(payload: string): unknown;
}

/**
 * Sends a rendered brief page with the headers every such page must carry.
 *
 * `extraHeaders` is for what differs between the two callers -- caching on the
 * published page, `X-Robots-Tag: noindex` and `no-store` on a draft -- and
 * cannot override the policy, which is set last.
 */
export function sendBriefPage(
  reply: BriefPageReply,
  html: string,
  extraHeaders: Record<string, string> = {}
): unknown {
  for (const [name, value] of Object.entries(extraHeaders)) reply.header(name, value);
  reply.header('Content-Security-Policy', BRIEF_PAGE_CSP);
  return reply.type('text/html; charset=utf-8').send(html);
}

/**
 * Hosts the rendered HTML asks the browser to load, by CSP directive.
 *
 * Anchors are excluded: a navigation is not a fetch, and `target="_blank"`
 * links to YouTube are the whole point of the picks section. `<link>` is read
 * as a stylesheet unless it declares `rel="preconnect"`, which loads nothing.
 */
export function fetchedHostsIn(html: string): { style: string[]; other: string[] } {
  const style = new Set<string>();
  const other = new Set<string>();
  const host = (url: string): string | null => {
    try {
      return new URL(url).origin;
    } catch {
      return null;
    }
  };
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (/rel\s*=\s*"[^"]*preconnect/i.test(tag)) continue;
    const href = tag.match(/href\s*=\s*"([^"]+)"/i)?.[1];
    const origin = href ? host(href) : null;
    if (origin) style.add(origin);
  }
  for (const tag of html.match(
    /<(?:script|img|iframe|video|audio|source|embed|object)\b[^>]*>/gi
  ) ?? []) {
    const src = tag.match(/(?:src|data)\s*=\s*"([^"]+)"/i)?.[1];
    const origin = src ? host(src) : null;
    if (origin) other.add(origin);
    // A tag with no external source still needs a directive of its own.
    else other.add(tag.match(/^<([a-z]+)/i)?.[1]?.toLowerCase() ?? 'unknown');
  }
  return { style: [...style], other: [...other] };
}
