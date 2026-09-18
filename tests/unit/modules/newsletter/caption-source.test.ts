/**
 * A caption source that cannot reach the collector has to say so, not claim
 * the video had no captions.
 *
 * Both look the same to the stage — null — so the distinction lives in what is
 * logged and in what the caller does next. What must never happen is a
 * collector outage being recorded as "these videos have no transcripts", which
 * would let an issue grade claims off metadata while reporting full coverage.
 */

const warn = jest.fn();
jest.mock('@/utils/logger', () => ({
  logger: { child: () => ({ info: jest.fn(), warn, error: jest.fn() }) },
}));

import { collectorCaptions, noCaptions } from '@/modules/newsletter/pipeline/caption-source';

const config = { baseUrl: 'http://collector', token: 'tok' };

beforeEach(() => warn.mockClear());

describe('collectorCaptions', () => {
  it('returns the text and sends the shared token', async () => {
    const fetchImpl = jest.fn(async () => new Response('caption text', { status: 200 }));
    const text = await collectorCaptions(config, fetchImpl as unknown as typeof fetch).get('abc');

    expect(text).toBe('caption text');
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['x-internal-token']).toBe('tok');
  });

  it('treats 404 as "no caption", quietly', async () => {
    const fetchImpl = jest.fn(async () => new Response('', { status: 404 }));
    expect(
      await collectorCaptions(config, fetchImpl as unknown as typeof fetch).get('a')
    ).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('warns when the collector refuses — that is not the same as no caption', async () => {
    const fetchImpl = jest.fn(async () => new Response('', { status: 500 }));
    expect(
      await collectorCaptions(config, fetchImpl as unknown as typeof fetch).get('a')
    ).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      'collector refused',
      expect.objectContaining({ status: 500 })
    );
  });

  it('warns when the collector is unreachable, and does not throw', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('ECONNREFUSED');
    });
    expect(
      await collectorCaptions(config, fetchImpl as unknown as typeof fetch).get('a')
    ).toBeNull();
    expect(warn).toHaveBeenCalledWith('collector unreachable', expect.objectContaining({}));
  });

  it('treats an empty body as no caption', async () => {
    const fetchImpl = jest.fn(async () => new Response('   ', { status: 200 }));
    expect(
      await collectorCaptions(config, fetchImpl as unknown as typeof fetch).get('a')
    ).toBeNull();
  });
});

describe('noCaptions', () => {
  it('returns null for everything', async () => {
    expect(await noCaptions.get('anything')).toBeNull();
  });
});
