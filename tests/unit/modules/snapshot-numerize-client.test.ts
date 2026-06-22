/**
 * numerize-client (⑤) tests — async JOB protocol + interpolation = 0:
 *   - service disabled ⇒ [] (no fetch, no fabrication);
 *   - job submit non-2xx / no job_id ⇒ [] (honest fail);
 *   - network error ⇒ [] (honest fail);
 *   - job failed/error status ⇒ [] (honest fail);
 *   - poll never reaches done within budget ⇒ [] (timeout, honest fail);
 *   - done ⇒ result figures mapped; unknown kinds dropped (not guessed).
 *
 * fetch is routed by URL: POST /numerize/job → {job_id}, GET …/status →
 * {status}, GET …/result → {figures}.
 */

const mockLoadConfig = jest.fn();
jest.mock('@/config/snapshot', () => ({
  loadSnapshotConfig: () => mockLoadConfig(),
}));

jest.mock('@/config/index', () => ({
  config: {
    database: { url: 'postgresql://postgres:pass@127.0.0.1:5432/postgres', directUrl: undefined },
    app: { isDevelopment: true, isProduction: false, isTest: true },
    paths: { logs: '/tmp' },
  },
}));

import { extractFigures } from '../../../src/modules/snapshot/numerize-client';

const enabled = {
  serviceUrl: 'http://svc:8077',
  serviceToken: 't',
  timeoutMs: 1000,
  enabled: true,
};
const disabled = { serviceUrl: '', serviceToken: '', timeoutMs: 1000, enabled: false };

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });

/** Route a mocked fetch by method+path. status='running' loops; small budget → fast timeout. */
function routedFetch(routes: { job?: unknown; status?: unknown | unknown[]; result?: unknown }) {
  let statusCall = 0;
  return jest.fn(async (url: string, init?: { method?: string }) => {
    const method = init?.method ?? 'GET';
    if (method === 'POST' && url.endsWith('/numerize/job')) return ok(routes.job);
    if (url.includes('/numerize/job/status')) {
      const s = Array.isArray(routes.status)
        ? routes.status[Math.min(statusCall++, routes.status.length - 1)]
        : routes.status;
      return ok(s);
    }
    if (url.includes('/numerize/job/result')) return ok(routes.result);
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
}

const fetchMock = jest.fn();
beforeEach(() => {
  mockLoadConfig.mockReset();
  fetchMock.mockReset();
  (global as { fetch?: unknown }).fetch = fetchMock;
});

describe('numerize-client (async job, interpolation = 0)', () => {
  it('returns [] without fetching when the service is disabled', async () => {
    mockLoadConfig.mockReturnValue(disabled);
    const out = await extractFigures('vid', [1, 2]);
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns [] (honest fail) when job submit is non-2xx', async () => {
    mockLoadConfig.mockReturnValue(enabled);
    (global as { fetch?: unknown }).fetch = jest.fn(async () => ({ ok: false, status: 502 }));
    expect(await extractFigures('vid', [1])).toEqual([]);
  });

  it('returns [] when the submit response has no job_id', async () => {
    mockLoadConfig.mockReturnValue(enabled);
    (global as { fetch?: unknown }).fetch = routedFetch({ job: {} });
    expect(await extractFigures('vid', [1])).toEqual([]);
  });

  it('returns [] (honest fail) on a network/timeout error', async () => {
    mockLoadConfig.mockReturnValue(enabled);
    (global as { fetch?: unknown }).fetch = jest.fn(async () => {
      throw new Error('aborted');
    });
    expect(await extractFigures('vid', [1])).toEqual([]);
  });

  it('returns [] when the job reports a terminal failure', async () => {
    mockLoadConfig.mockReturnValue(enabled);
    (global as { fetch?: unknown }).fetch = routedFetch({
      job: { job_id: 'j1' },
      status: { status: 'failed', failure_stage: 'cv_extract' },
    });
    expect(await extractFigures('vid', [1])).toEqual([]);
  });

  it('returns [] when polling never reaches done within the budget', async () => {
    mockLoadConfig.mockReturnValue({ ...enabled, timeoutMs: 0 }); // deadline immediately past
    (global as { fetch?: unknown }).fetch = routedFetch({
      job: { job_id: 'j1' },
      status: { status: 'running', progress_pct: 20 },
    });
    expect(await extractFigures('vid', [1])).toEqual([]);
  });

  it('on done, maps result figures and drops unknown kinds (no guessing)', async () => {
    mockLoadConfig.mockReturnValue({ ...enabled, timeoutMs: 5000 });
    // first status poll returns done → no idle sleep (the running→sleep→repoll
    // path is exercised by the timeout test); keeps this unit test fast.
    (global as { fetch?: unknown }).fetch = routedFetch({
      job: { job_id: 'j1' },
      status: { status: 'done', progress_pct: 100 },
      result: {
        job_id: 'j1',
        figures: [
          { kind: 'chart', ts_sec: 5, struct: { bars: 3 } },
          { kind: 'equation', ts_sec: 9, latex: 'x^2' },
          { kind: 'bogus', ts_sec: 12 }, // unknown kind → dropped
          { kind: 'keyframe' }, // no ts_sec → dropped
        ],
      },
    });
    const out = await extractFigures('vid', [5, 9, 12]);
    expect(out).toHaveLength(2);
    expect(out.map((f) => f.kind)).toEqual(['chart', 'equation']);
    expect(out[0]!.source).toBe('numerize');
  });
});
