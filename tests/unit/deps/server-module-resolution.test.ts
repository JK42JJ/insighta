/**
 * The modules the API server loads at start must resolve from the lockfile.
 *
 * 2026-09-15: the lockfile refresh in #1636 hoisted ajv 6 to the root while
 * @scalar/json-schema-validator (through @fastify/swagger-ui) pulled in
 * ajv-draft-04, which requires ajv 8. Nothing in the test suite imported the
 * swagger plugin, the smoke tests skip booting the server, and the build does
 * not execute modules -- so the first place it failed was the production pod,
 * in CrashLoopBackOff with "Cannot find module 'ajv/dist/core'". This test
 * runs on the same install CI performs, so a lockfile that cannot load the
 * server fails here instead.
 */

describe('server module resolution', () => {
  const mustLoad = ['fastify', '@fastify/swagger', '@fastify/swagger-ui', 'ajv-draft-04', 'ajv'];

  it.each(mustLoad)('%s loads', (name) => {
    expect(() => require(name)).not.toThrow();
  });

  it('resolves ajv 8 at the root, which fastify and ajv-draft-04 require', () => {
    const { version } = require('ajv/package.json') as { version: string };
    expect(Number(version.split('.')[0])).toBeGreaterThanOrEqual(8);
  });
});
