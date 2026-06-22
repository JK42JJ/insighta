/**
 * deck-storage (③) — Supabase Storage deck uploader. Mock config + fetch.
 * Locks: public URL shape, upload endpoint + x-upsert/content-type, throw on fail.
 */

jest.mock('@/config/index', () => ({
  config: { supabase: { url: 'https://proj.supabase.co', serviceRoleKey: 'svc-key' } },
}));

import { uploadDeckPptx, deckPublicUrl, deckObjectPath } from '../../../src/modules/deck/deck-storage';

const M = '942e2757-64fa-4759-afc5-56e2f33869f2';

describe('deck-storage (Supabase)', () => {
  it('builds the object path + public URL', () => {
    expect(deckObjectPath(M)).toBe(`${M}.pptx`);
    expect(deckPublicUrl(M)).toBe(
      `https://proj.supabase.co/storage/v1/object/public/slide-decks/${M}.pptx`
    );
  });

  it('uploads bytes (upsert + pptx content-type) and returns the public URL', async () => {
    const fetchMock = jest.fn(async (..._a: unknown[]) => ({ ok: true, status: 200, text: async () => '' }));
    (global as { fetch?: unknown }).fetch = fetchMock;

    const url = await uploadDeckPptx(M, Buffer.from('deck'));

    const [endpoint, init] = fetchMock.mock.calls[0]! as unknown as [
      string,
      { method: string; headers: Record<string, string> },
    ];
    expect(endpoint).toBe(`https://proj.supabase.co/storage/v1/object/slide-decks/${M}.pptx`);
    expect(init.method).toBe('POST');
    expect(init.headers['x-upsert']).toBe('true');
    expect(init.headers['Content-Type']).toContain('presentationml.presentation');
    expect(init.headers['Authorization']).toBe('Bearer svc-key');
    expect(url).toBe(`https://proj.supabase.co/storage/v1/object/public/slide-decks/${M}.pptx`);
  });

  it('throws on non-2xx upload (caller marks deck failed)', async () => {
    (global as { fetch?: unknown }).fetch = jest.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => 'forbidden',
    }));
    await expect(uploadDeckPptx(M, Buffer.from('x'))).rejects.toThrow(/403/);
  });
});
