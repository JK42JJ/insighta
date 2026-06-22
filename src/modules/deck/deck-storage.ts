// ③ deck-build — Supabase Storage uploader for deck .pptx files.
//
// Deck-specific uploader on the Supabase Storage REST API (global fetch, no
// extra deps). Intentionally NOT importing the untracked sales-resources wrapper
// (src/modules/storage/supabase-storage.ts) — that's a separate WIP track; this
// references the same REST shape to avoid a cross-PR file collision.
//
// Bucket `slide-decks` (public-read) must exist in Supabase (James-provisioned).
// Upserts on the mandala-keyed path so a re-generate overwrites cleanly.

import { config } from '@/config/index';

/** Public bucket holding generated deck .pptx files. */
export const SLIDE_DECKS_BUCKET = 'slide-decks';

const PPTX_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.presentation';

function requireSupabase(): { url: string; key: string } {
  const url = config.supabase.url;
  const key = config.supabase.serviceRoleKey;
  if (!url || !key) {
    throw new Error(
      'Supabase storage not configured: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing.'
    );
  }
  return { url, key };
}

/** Object path for a mandala's deck within the bucket (one per mandala). */
export function deckObjectPath(mandalaId: string): string {
  return `${mandalaId}.pptx`;
}

/** Public URL for the deck object (no network call — purely structural). */
export function deckPublicUrl(mandalaId: string): string {
  const { url } = requireSupabase();
  return `${url}/storage/v1/object/public/${SLIDE_DECKS_BUCKET}/${deckObjectPath(mandalaId)}`;
}

/**
 * Upload the deck .pptx bytes and return its public URL. x-upsert:true so a
 * re-generate overwrites the prior deck. Throws on non-2xx (caller marks failed).
 */
export async function uploadDeckPptx(mandalaId: string, body: Buffer): Promise<string> {
  const { url, key } = requireSupabase();
  const path = deckObjectPath(mandalaId);
  const endpoint = `${url}/storage/v1/object/${SLIDE_DECKS_BUCKET}/${path}`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': PPTX_CONTENT_TYPE,
      'x-upsert': 'true',
    },
    body: body as unknown as BodyInit,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase deck upload failed [${res.status}]: ${text.slice(0, 200)}`);
  }
  return deckPublicUrl(mandalaId);
}
