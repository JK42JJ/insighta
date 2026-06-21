/**
 * numerize-client (⑤) tests — interpolation = 0 at the extraction boundary:
 *   - service disabled ⇒ [] (no fetch, no fabrication);
 *   - service non-2xx / network error ⇒ [] (honest fail);
 *   - valid response ⇒ figures mapped; unknown kinds dropped (not guessed).
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
  serviceUrl: 'https://pod-8000.proxy.runpod.net',
  serviceToken: 't',
  timeoutMs: 1000,
  enabled: true,
};
const disabled = { serviceUrl: '', serviceToken: '', timeoutMs: 1000, enabled: false };

const fetchMock = jest.fn();
beforeEach(() => {
  mockLoadConfig.mockReset();
  fetchMock.mockReset();
  (global as { fetch?: unknown }).fetch = fetchMock;
});

describe('numerize-client (interpolation = 0)', () => {
  it('returns [] without fetching when the service is disabled', async () => {
    mockLoadConfig.mockReturnValue(disabled);
    const out = await extractFigures('vid', [1, 2]);
    expect(out).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns [] (honest fail) on a non-2xx response', async () => {
    mockLoadConfig.mockReturnValue(enabled);
    fetchMock.mockResolvedValue({ ok: false, status: 502 });
    const out = await extractFigures('vid', [1]);
    expect(out).toEqual([]);
  });

  it('returns [] (honest fail) on a network/timeout error', async () => {
    mockLoadConfig.mockReturnValue(enabled);
    fetchMock.mockRejectedValue(new Error('aborted'));
    const out = await extractFigures('vid', [1]);
    expect(out).toEqual([]);
  });

  it('maps valid figures and drops unknown kinds (no guessing)', async () => {
    mockLoadConfig.mockReturnValue(enabled);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        figures: [
          { kind: 'chart', ts_sec: 5, struct: { bars: 3 } },
          { kind: 'equation', ts_sec: 9, latex: 'x^2' },
          { kind: 'bogus', ts_sec: 12 }, // unknown kind → dropped
          { kind: 'keyframe' }, // no ts_sec → dropped
        ],
      }),
    });
    const out = await extractFigures('vid', [5, 9, 12]);
    expect(out).toHaveLength(2);
    expect(out.map((f) => f.kind)).toEqual(['chart', 'equation']);
    expect(out[0]!.source).toBe('numerize');
  });
});
