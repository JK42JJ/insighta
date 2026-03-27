// Mock for @scalar/fastify-api-reference (ESM module incompatible with Jest CJS)
import { FastifyInstance } from 'fastify';

async function scalarPlugin(fastify: FastifyInstance) {
  // no-op in tests
  fastify.log.info('Scalar mock registered (test environment)');
}

export default scalarPlugin;
