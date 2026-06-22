/**
 * slides-build-client (③) — /slides/build job → .pptx bytes. Mock fetch routed
 * by URL. Locks honest-fail (disabled/submit-fail/no-job_id/failed) + done→Buffer.
 * (Poll-timeout path is the same loop as numerize-client, covered there.)
 */

const mockLoadConfig = jest.fn();
jest.mock('@/config/snapshot', () => ({ loadSnapshotConfig: () => mockLoadConfig() }));
jest.mock('@/config/index', () => ({
  config: {
    database: { url: 'postgresql://x:x@127.0.0.1:5432/x', directUrl: undefined },
    app: { isDevelopment: true, isProduction: false, isTest: true },
    paths: { logs: '/tmp' },
  },
}));

import { buildDeck } from '../../../src/modules/deck/slides-build-client';

const enabled = { serviceUrl: 'http://svc:8077', serviceToken: 't', timeoutMs: 1000, enabled: true };
const disabled = { serviceUrl: '', serviceToken: '', timeoutMs: 1000, enabled: false };
const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const okBytes = (buf: Buffer) => ({ ok: true, status: 200, arrayBuffer: async () => buf });

function routed(routes: { job?: unknown; status?: unknown; result?: { ok: boolean; status?: number; buf?: Buffer } }) {
  return jest.fn(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST' && url.endsWith('/slides/build')) return okJson(routes.job);
    if (url.includes('/slides/build/status')) return okJson(routes.status);
    if (url.includes('/slides/build/result')) {
      const r = routes.result!;
      return r.ok ? okBytes(r.buf!) : { ok: false, status: r.status ?? 500 };
    }
    throw new Error(`unexpected ${method} ${url}`);
  });
}

beforeEach(() => mockLoadConfig.mockReset());

describe('buildDeck (slides/build job → bytes)', () => {
  it('returns null when the service is disabled', async () => {
    mockLoadConfig.mockReturnValue(disabled);
    (global as { fetch?: unknown }).fetch = jest.fn();
    expect(await buildDeck({}, [])).toBeNull();
  });

  it('returns null on submit non-2xx', async () => {
    mockLoadConfig.mockReturnValue(enabled);
    (global as { fetch?: unknown }).fetch = jest.fn(async () => ({ ok: false, status: 502 }));
    expect(await buildDeck({}, [])).toBeNull();
  });

  it('returns null when submit has no job_id', async () => {
    mockLoadConfig.mockReturnValue(enabled);
    (global as { fetch?: unknown }).fetch = routed({ job: {} });
    expect(await buildDeck({}, [])).toBeNull();
  });

  it('returns null on terminal failure status', async () => {
    mockLoadConfig.mockReturnValue(enabled);
    (global as { fetch?: unknown }).fetch = routed({ job: { job_id: 'b1' }, status: { status: 'failed', failure_stage: 'render' } });
    expect(await buildDeck({}, [])).toBeNull();
  });

  it('returns the .pptx bytes on done', async () => {
    mockLoadConfig.mockReturnValue(enabled);
    const bytes = Buffer.from('PK\x03\x04 fake pptx');
    (global as { fetch?: unknown }).fetch = routed({
      job: { job_id: 'b1' },
      status: { status: 'done', progress_pct: 100 },
      result: { ok: true, buf: bytes },
    });
    const out = await buildDeck({ chapters: [] }, []);
    expect(Buffer.isBuffer(out)).toBe(true);
    expect(out!.equals(bytes)).toBe(true);
  });

  it('returns null when the done result is empty', async () => {
    mockLoadConfig.mockReturnValue(enabled);
    (global as { fetch?: unknown }).fetch = routed({
      job: { job_id: 'b1' },
      status: { status: 'done' },
      result: { ok: true, buf: Buffer.alloc(0) },
    });
    expect(await buildDeck({}, [])).toBeNull();
  });
});
