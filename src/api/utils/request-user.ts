/**
 * The signed-in account, read off the request.
 *
 * `request.user` is already typed: the auth plugin augments `@fastify/jwt` with
 * `JWTPayload`, whose field is `userId`. Reaching for `id` does not compile.
 *
 * It compiled anyway in five brief handlers, because they cast first:
 *
 *   const userId = (request.user as { id?: string } | undefined)?.id;
 *
 * The cast discards the real type, so `id` — a field that has never existed on
 * this object — type-checked, came back `undefined`, and every one of those
 * routes answered 401 to a valid token. `/brief/subscribed` and
 * `/brief/categories` returned 401 thirteen times each while
 * `/api/v1/mandalas/list` returned 200 twenty-four times in the same session.
 *
 * So this function exists less to save four lines than to give the right thing
 * a name, and to make the cast that hid the bug unnecessary. Three route files
 * already carried a private copy of this logic with three different 401 bodies;
 * they now share the extraction and keep their own replies, because changing
 * what a route sends on 401 is a separate decision from where it reads the id.
 */

import type { FastifyRequest } from 'fastify';

/** The account id, or null when the request is not authenticated. */
export function userIdOf(request: FastifyRequest): string | null {
  return request.user?.userId ?? null;
}
