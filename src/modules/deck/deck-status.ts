// ③ deck UI scaffold — slide_decks lifecycle helpers.
//
// The deck button reads `status` to render 없음 / 생성중 / 완료+링크 across
// reloads. Lifecycle: pending (data-prep enqueued) → building (deck-build calls
// slidegen /slides/build) → done (pptx_url = Supabase Storage public URL) |
// failed. This module owns slide_decks read/write. No fabrication — pptx_url is
// set only by a real, uploaded build.

import { getPrismaClient } from '@/modules/database/client';

export type DeckStatus = 'pending' | 'building' | 'done' | 'failed';

export interface DeckState {
  mandalaId: string;
  status: DeckStatus;
  pptxUrl: string | null;
  error: string | null;
  generatedAt: Date | null;
}

/** Read the deck row, or null if the deck was never requested for this mandala. */
export async function getDeckState(mandalaId: string): Promise<DeckState | null> {
  const row = await getPrismaClient().slide_decks.findUnique({ where: { mandala_id: mandalaId } });
  if (!row) return null;
  return {
    mandalaId: row.mandala_id,
    status: row.status as DeckStatus,
    pptxUrl: row.pptx_url,
    error: row.error,
    generatedAt: row.generated_at,
  };
}

/**
 * Mark a deck as requested: upsert the row to 'pending', clearing any prior
 * pptx_url/error so a re-generate starts clean. Called by the generate-deck
 * button before the data-prep jobs are enqueued.
 */
export async function markDeckPending(mandalaId: string): Promise<void> {
  await getPrismaClient().slide_decks.upsert({
    where: { mandala_id: mandalaId },
    create: { mandala_id: mandalaId, status: 'pending' },
    update: { status: 'pending', pptx_url: null, error: null, generated_at: null },
  });
}

/** Move a deck to 'building' (deck-build job started the slidegen call). */
export async function markDeckBuilding(mandalaId: string): Promise<void> {
  await getPrismaClient().slide_decks.update({
    where: { mandala_id: mandalaId },
    data: { status: 'building', error: null },
  });
}

/**
 * Mark a deck done with its Supabase Storage public URL (what the FE opens).
 */
export async function markDeckDone(mandalaId: string, pptxUrl: string): Promise<void> {
  await getPrismaClient().slide_decks.update({
    where: { mandala_id: mandalaId },
    data: { status: 'done', pptx_url: pptxUrl, error: null, generated_at: new Date() },
  });
}

/** Mark a deck failed with a short reason (honest — no fake success). */
export async function markDeckFailed(mandalaId: string, error: string): Promise<void> {
  await getPrismaClient().slide_decks.update({
    where: { mandala_id: mandalaId },
    data: { status: 'failed', error: error.slice(0, 500) },
  });
}
