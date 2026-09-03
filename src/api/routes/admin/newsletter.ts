/**
 * Admin -- register and publish brief issues.
 *
 * This is the path that replaces writing an HTML file by hand. An editor
 * submits an IssueDocument; the product renders the page, the mail digest and
 * the note chapter from it. Nothing downstream accepts markup.
 *
 * Admin-gated per the hard rule for new admin routes: onRequest carries both
 * authenticate and authenticateAdmin, and an unauthenticated curl must 401.
 */

import { FastifyInstance } from 'fastify';
import { getPrismaClient } from '../../../modules/database/client';
import {
  IssueDocumentSchema,
  findUngroundedClaims,
  issueNumber,
  type IssueDocument,
} from '../../../modules/newsletter/issue-schema';
import { isTemplateId, renderWeb } from '../../../modules/newsletter/render-web';
import { clearBriefCache } from '../brief';
import { CATEGORY_KEYS } from '@/modules/newsletter/categories';

const UUID = /^[0-9a-f-]{36}$/i;

export async function adminNewsletterRoutes(fastify: FastifyInstance) {
  const adminAuth = { onRequest: [fastify.authenticate, fastify.authenticateAdmin] };

  /**
   * Validation is shared by create and update so a draft cannot be published
   * through the path with the weaker check. Returns the parsed document or a
   * reason, never a partially-validated object.
   */
  function validate(body: unknown): { doc: IssueDocument } | { error: string } {
    const parsed = IssueDocumentSchema.safeParse(body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return { error: `invalid issue document: ${first?.path.join('.')} ${first?.message}` };
    }
    const doc = parsed.data;
    if (!CATEGORY_KEYS.has(doc.categoryKey)) {
      return { error: `unknown categoryKey "${doc.categoryKey}"` };
    }
    if (!isTemplateId(doc.templateVersion)) {
      return { error: `unknown templateVersion "${doc.templateVersion}"` };
    }
    // The launch issue shipped 확인 badges on figures that had no source. A
    // graded claim with nothing behind it is refused here rather than caught
    // in review, because review is what missed it the first time.
    const ungrounded = findUngroundedClaims(doc);
    if (ungrounded.length > 0) {
      return { error: `ungrounded claims: ${ungrounded.join('; ')}` };
    }
    return { doc };
  }

  fastify.get<{ Querystring: { category?: string } }>(
    '/newsletter/issues',
    adminAuth,
    async (request, reply) => {
      const { category } = request.query;
      const rows = await getPrismaClient().newsletter_issues.findMany({
        where: category ? { category_key: category } : undefined,
        orderBy: [{ category_key: 'asc' }, { issue_no: 'desc' }],
        // content_json is excluded: the list screen shows headlines, and a
        // hundred issues of body copy is a slow page for no reason.
        select: {
          id: true,
          slug: true,
          locale: true,
          category_key: true,
          issue_no: true,
          template_version: true,
          published_at: true,
          updated_at: true,
        },
      });
      return reply.send({ status: 'ok', data: { issues: rows } });
    }
  );

  fastify.get<{ Params: { id: string } }>(
    '/newsletter/issues/:id',
    adminAuth,
    async (request, reply) => {
      if (!UUID.test(request.params.id)) {
        return reply.code(400).send({ status: 'error', error: 'invalid id' });
      }
      const row = await getPrismaClient().newsletter_issues.findUnique({
        where: { id: request.params.id },
      });
      if (!row) return reply.code(404).send({ status: 'error', error: 'not found' });
      return reply.send({ status: 'ok', data: { issue: row } });
    }
  );

  /**
   * GET /api/v1/admin/newsletter/issues/:id/preview
   *
   * The rendered page for an issue that has not been published.
   *
   * The public route filters on `published_at` — that filter is the access
   * control, not an ordering hint — so a draft cannot be read by guessing its
   * slug. Which left an editor with no way to look at what they were about to
   * publish: the admin list only offers a link once the issue is already live,
   * which is one step too late to be a review.
   *
   * Same renderer and same template as the public page, so what is approved
   * here is what ships. Admin-gated like every other route in this file, and
   * `noindex` besides — an unpublished issue must not be indexed if the URL
   * ever escapes.
   */
  fastify.get<{ Params: { id: string } }>(
    '/newsletter/issues/:id/preview',
    adminAuth,
    async (request, reply) => {
      if (!UUID.test(request.params.id)) {
        return reply.code(400).type('text/plain; charset=utf-8').send('invalid id');
      }
      const row = await getPrismaClient().newsletter_issues.findUnique({
        where: { id: request.params.id },
        select: { content_json: true, template_version: true, locale: true, published_at: true },
      });
      if (!row) return reply.code(404).type('text/plain; charset=utf-8').send('not found');

      const parsed = IssueDocumentSchema.safeParse(row.content_json);
      if (!parsed.success) {
        // A preview that half-renders a broken document is worse than an error:
        // the reviewer approves what they saw, and what ships is the rest.
        return reply
          .code(422)
          .type('text/plain; charset=utf-8')
          .send(
            'this issue does not match the document contract:\n' +
              parsed.error.issues
                .slice(0, 10)
                .map((i) => `  ${i.path.join('.')}: ${i.message}`)
                .join('\n')
          );
      }

      const doc = {
        ...parsed.data,
        templateVersion: row.template_version,
        locale: row.locale === 'en' ? ('en' as const) : ('ko' as const),
      };

      // A banner, so a screenshot of a preview is never mistaken for the page.
      const banner = row.published_at
        ? ''
        : '<div style="position:sticky;top:0;z-index:99;background:#1c1b18;color:#f2efe6;' +
          'font:600 12px/1.6 -apple-system,system-ui,sans-serif;padding:8px 16px">' +
          'DRAFT — not published</div>';

      return reply
        .header('X-Robots-Tag', 'noindex, nofollow')
        .header('Cache-Control', 'no-store')
        .type('text/html; charset=utf-8')
        .send(renderWeb(doc).replace('<body>', `<body>${banner}`));
    }
  );

  fastify.post<{ Body: { document?: unknown; publish?: boolean } }>(
    '/newsletter/issues',
    adminAuth,
    async (request, reply) => {
      const result = validate(request.body?.document);
      if ('error' in result) {
        return reply.code(400).send({ status: 'error', error: result.error });
      }
      const { doc } = result;

      const existing = await getPrismaClient().newsletter_issues.findUnique({
        where: { slug: doc.slug },
        select: { id: true },
      });
      if (existing) {
        return reply
          .code(409)
          .send({ status: 'error', error: `slug "${doc.slug}" already exists` });
      }

      const row = await getPrismaClient().newsletter_issues.create({
        data: {
          slug: doc.slug,
          category_key: doc.categoryKey,
          issue_no: issueNumber(doc),
          schema_version: doc.schemaVersion,
          template_version: doc.templateVersion,
          // Projected out of the document so the identity — one issue number,
          // one edition per language — is a database constraint rather than a
          // convention, and so a list of issues can be filtered without
          // parsing every content_json.
          locale: doc.locale,
          content_json: doc as unknown as object,
          // Publishing is an explicit act, not a side effect of saving.
          published_at: request.body?.publish ? new Date() : null,
        },
        select: { id: true, slug: true, published_at: true },
      });
      return reply.code(201).send({ status: 'ok', data: { issue: row } });
    }
  );

  fastify.put<{ Params: { id: string }; Body: { document?: unknown; publish?: boolean } }>(
    '/newsletter/issues/:id',
    adminAuth,
    async (request, reply) => {
      if (!UUID.test(request.params.id)) {
        return reply.code(400).send({ status: 'error', error: 'invalid id' });
      }
      const result = validate(request.body?.document);
      if ('error' in result) {
        return reply.code(400).send({ status: 'error', error: result.error });
      }
      const { doc } = result;

      const current = await getPrismaClient().newsletter_issues.findUnique({
        where: { id: request.params.id },
        select: { published_at: true },
      });
      if (!current) return reply.code(404).send({ status: 'error', error: 'not found' });

      const row = await getPrismaClient().newsletter_issues.update({
        where: { id: request.params.id },
        data: {
          slug: doc.slug,
          category_key: doc.categoryKey,
          issue_no: issueNumber(doc),
          schema_version: doc.schemaVersion,
          template_version: doc.templateVersion,
          locale: doc.locale,
          content_json: doc as unknown as object,
          // Re-publishing must not move the original date: readers cite it,
          // and a correction is not a new issue.
          published_at:
            request.body?.publish && current.published_at === null
              ? new Date()
              : current.published_at,
        },
        select: { id: true, slug: true, published_at: true },
      });

      // The rendered page is cached by (slug, templateVersion); an edit that
      // keeps both would otherwise keep serving the old body.
      clearBriefCache();
      return reply.send({ status: 'ok', data: { issue: row } });
    }
  );

  fastify.delete<{ Params: { id: string } }>(
    '/newsletter/issues/:id',
    adminAuth,
    async (request, reply) => {
      if (!UUID.test(request.params.id)) {
        return reply.code(400).send({ status: 'error', error: 'invalid id' });
      }
      await getPrismaClient().newsletter_issues.deleteMany({ where: { id: request.params.id } });
      clearBriefCache();
      return reply.send({ status: 'ok' });
    }
  );
}
