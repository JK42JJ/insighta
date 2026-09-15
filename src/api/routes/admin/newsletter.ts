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
import { issueLabelOf } from '@/modules/newsletter/issue-label';
import { MissingMailDigestError } from '@/modules/newsletter/render-mail';
import { IssueSendError, planIssueSend, runIssueSend } from '@/modules/newsletter/send-issue';

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Publishing needs a cover. The list card shows the lead pick's thumbnail,
 * and an issue that goes out without one shows the category's stand-in on
 * every shelf it appears on. A draft can be saved without it; publishing
 * cannot.
 */
function publishBlocker(doc: IssueDocument): string | null {
  if (!doc.picks[0]?.videoId) {
    return 'cannot publish without a lead pick that has a videoId (the cover)';
  }
  return null;
}

/**
 * The unique index on (category, issue number, locale) is the identity rule.
 * Prisma reports a collision as P2002; without this it surfaces as a 500 that
 * says nothing about which number is taken.
 */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'P2002';
}

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
      const blocker = request.body?.publish ? publishBlocker(doc) : null;
      if (blocker) return reply.code(400).send({ status: 'error', error: blocker });

      const issueNo = issueNumber(doc);
      try {
        const row = await getPrismaClient().newsletter_issues.create({
          data: {
            slug: doc.slug,
            category_key: doc.categoryKey,
            issue_no: issueNo,
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
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        return reply.code(409).send({
          status: 'error',
          error: `${issueLabelOf(issueNo, doc.locale)} already exists in ${doc.categoryKey} (${doc.locale}); the number comes from issueLabel`,
        });
      }
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

      const willBePublished = Boolean(request.body?.publish) || current.published_at !== null;
      const blocker = willBePublished ? publishBlocker(doc) : null;
      if (blocker) return reply.code(400).send({ status: 'error', error: blocker });

      const issueNo = issueNumber(doc);
      try {
        const row = await getPrismaClient().newsletter_issues.update({
          where: { id: request.params.id },
          data: {
            slug: doc.slug,
            category_key: doc.categoryKey,
            issue_no: issueNo,
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
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        return reply.code(409).send({
          status: 'error',
          error: `${issueLabelOf(issueNo, doc.locale)} already exists in ${doc.categoryKey} (${doc.locale}); the number comes from issueLabel`,
        });
      }
    }
  );

  /**
   * POST /api/v1/admin/newsletter/issues/:id/send
   *
   * Mail one published issue to its subscribers. Dry run unless the body says
   * otherwise, and the real send must carry back the recipient count the dry
   * run reported -- the same shape as the product broadcast, for the same
   * reason: a send cannot be recalled.
   *
   * The dry run is also the review: it returns the subject, the CTA target
   * (the issue page), one recipient's unsubscribe link and the list headers
   * every mail will carry.
   */
  fastify.post<{
    Params: { id: string };
    Body: { dryRun?: boolean; expectedRecipients?: number };
  }>('/newsletter/issues/:id/send', adminAuth, async (request, reply) => {
    if (!UUID.test(request.params.id)) {
      return reply.code(400).send({ status: 'error', error: 'invalid id' });
    }
    const dryRun = request.body?.dryRun !== false;
    try {
      if (dryRun) {
        const plan = await planIssueSend(request.params.id);
        return reply.send({ status: 'ok', data: { dryRun: true, ...plan } });
      }
      const expected = request.body?.expectedRecipients;
      if (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 0) {
        return reply.code(400).send({
          status: 'error',
          error: 'expectedRecipients must be the integer the dry run reported',
        });
      }
      const result = await runIssueSend(request.params.id, expected);
      return reply.send({ status: 'ok', data: { dryRun: false, ...result } });
    } catch (err) {
      if (err instanceof IssueSendError) {
        const code = err.code === 'NOT_FOUND' ? 404 : err.code === 'COUNT_MISMATCH' ? 409 : 400;
        return reply.code(code).send({ status: 'error', error: err.message });
      }
      if (err instanceof MissingMailDigestError) {
        return reply.code(400).send({ status: 'error', error: err.message });
      }
      throw err;
    }
  });

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
