/**
 * Template selection for the web surface.
 *
 * Rendering happens on read, not at publish time. Baking HTML when an issue
 * goes out would freeze every past issue in the design it shipped with, so a
 * later improvement could only ever reach future issues. Rendering on read
 * means raising DEFAULT_TEMPLATE re-skins the whole archive at once.
 *
 * The cost is a render per request, absorbed by a cache keyed on
 * (slug, templateVersion). Because the key carries the version, publishing a
 * new template invalidates the cache by construction -- there is no purge step
 * to forget.
 */

import type { IssueDocument } from './issue-schema';
import * as webV1 from './templates/web-v1';

export type TemplateId = 'web-v1';

const TEMPLATES: Record<TemplateId, { render: (doc: IssueDocument) => string }> = {
  'web-v1': webV1,
};

/**
 * Raise this to re-skin every issue that has not pinned a version of its own.
 * An issue pins `templateVersion` only when a new template breaks that
 * particular issue -- one issue held back, rather than the archive rolled back.
 */
export const DEFAULT_TEMPLATE: TemplateId = 'web-v1';

export function isTemplateId(v: string): v is TemplateId {
  return Object.prototype.hasOwnProperty.call(TEMPLATES, v);
}

export function renderWeb(doc: IssueDocument, override?: TemplateId): string {
  const requested = override ?? doc.templateVersion;
  // An unknown version must not 500 a published issue. Falling back keeps the
  // page readable; the wrong-looking page is recoverable, a blank one is not.
  const id: TemplateId = isTemplateId(requested) ? requested : DEFAULT_TEMPLATE;
  return TEMPLATES[id].render(doc);
}

/** Cache key. Version-bearing so a template change cannot serve stale HTML. */
export function renderCacheKey(doc: IssueDocument, override?: TemplateId): string {
  const requested = override ?? doc.templateVersion;
  const id = isTemplateId(requested) ? requested : DEFAULT_TEMPLATE;
  return `brief:${doc.slug}:${id}`;
}
