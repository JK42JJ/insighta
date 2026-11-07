/**
 * Morning cards routes (PRD #1788). stg-only, behind MOBILE_MORNING_CARDS.
 * Flag off -> 404 for everyone; flag on -> 403 unless the user is on the
 * test-account allowlist. Cards come from the existing video pool only.
 */
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { getPrismaClient } from '@/modules/database/client';
import { isMorningCardsEnabled, isMorningCardsTestUser } from '@/config/morning-cards';
import { isMorningCardDomainKey } from '@/modules/morning-cards/domains';
import { fetchMorningCardsWithShortage, type MorningCardsDb } from '@/modules/morning-cards/source';
import { userIdOf } from '@/api/utils/request-user';

export interface MorningCardsRouteDeps {
  getDb: () => MorningCardsDb;
}

const defaultDeps: MorningCardsRouteDeps = {
  getDb: () => getPrismaClient() as unknown as MorningCardsDb,
};

async function flagGate(_request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isMorningCardsEnabled()) {
    return reply.code(404).send({ status: 'error', error: 'not_found' });
  }
}

export function createMorningCardsRoutes(deps: MorningCardsRouteDeps = defaultDeps) {
  return async function morningCardsRoutes(fastify: FastifyInstance): Promise<void> {
    fastify.get<{ Querystring: { domain?: string } }>(
      '/',
      { onRequest: [flagGate, fastify.authenticate] },
      async (request, reply) => {
        const userId = userIdOf(request);
        if (!userId) return reply.code(401).send({ status: 'error', error: 'unauthenticated' });
        if (!isMorningCardsTestUser(userId)) {
          return reply.code(403).send({ status: 'error', error: 'forbidden' });
        }
        const domain = request.query.domain;
        if (!isMorningCardDomainKey(domain)) {
          return reply.code(400).send({ status: 'error', error: 'invalid_domain' });
        }
        const { cards, shortage } = await fetchMorningCardsWithShortage(deps.getDb(), domain);
        return reply.send({ status: 'ok', data: { domain, cards, shortage } });
      }
    );
  };
}

export const morningCardsRoutes = createMorningCardsRoutes();
