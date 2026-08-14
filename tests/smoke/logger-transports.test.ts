/**
 * The application runs two loggers with different content:
 *
 *   fastify (pino)  -> stdout   HTTP request and response lines
 *   winston         -> files    module-level logs and errors
 *
 * In production winston had no Console transport, so its lines existed only
 * in /app/logs. `docker logs` and `kubectl logs` carried the request lines
 * and none of these. That is survivable while the log directory is a named
 * volume — the files outlive a restart — and stops being survivable in a
 * cluster, where the directory is per-pod and a reschedule takes the only
 * copy with it.
 *
 * These tests pin the transport set so the production case cannot silently
 * lose its console again.
 */

describe('winston transports by environment', () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
    jest.resetModules();
  });

  function transportsFor(env: Record<string, string>): string[] {
    jest.resetModules();
    // Importing the logger pulls in the config module, whose schema requires
    // a secret of at least 64 characters. Supplying a filler keeps the test
    // about transports rather than about configuration loading.
    process.env = { ...ORIGINAL, ENCRYPTION_SECRET: 'x'.repeat(64), ...env };
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { logger } = require('../../src/utils/logger');
    return logger.transports.map((t: { constructor: { name: string } }) => t.constructor.name);
  }

  it('writes to the console in production, not only to files', () => {
    const names = transportsFor({ NODE_ENV: 'production' });
    expect(names).toContain('Console');
  });

  it('keeps the file transports in production', () => {
    const names = transportsFor({ NODE_ENV: 'production' });
    // Removing these would change behaviour on the current host, where the
    // files are what anyone reading logs actually opens.
    expect(names.filter((n) => n === 'File').length).toBeGreaterThanOrEqual(2);
  });

  it('writes to the console in development too', () => {
    const names = transportsFor({ NODE_ENV: 'development' });
    expect(names).toContain('Console');
  });

  // Negative control: the assertion above has to be capable of failing, or it
  // would keep passing against a logger with no console at all.
  it('can tell a transport list apart from one missing Console', () => {
    const withConsole = ['File', 'File', 'Console'];
    const without = ['File', 'File'];
    expect(withConsole).toContain('Console');
    expect(without).not.toContain('Console');
  });
});
