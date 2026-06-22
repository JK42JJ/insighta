// ③ deck UI scaffold — slide_decks lifecycle helpers.
//
// The deck button reads `status` to render 없음 / 생성중 / 완료+링크 across
// reloads. Lifecycle: pending (data-prep enqueued) → building (deck-build calls
// slidegen /slides/build — wired when that endpoint deploys) → done (pptx_url
// set) | failed. This module owns slide_decks read/write; the serving route and
// SSE read through it. No fabrication — pptx_url is set only by a real build.

import path from 'node:path';
import { getPrismaClient } from '@/modules/database/client';
import { config } from '@/config/index';

export type DeckStatus = 'pending' | 'building' | 'done' | 'failed';

export interface DeckState {
  mandalaId: string;
  status: DeckStatus;
  pptxUrl: string | null;
  error: string | null;
  generatedAt: Date | null;
}

/** The authenticated serving-route path for a mandala's .pptx (stored in pptx_url). */
export function deckPptxRoutePath(mandalaId: string): string {
  return `/api/v1/mandalas/${mandalaId}/deck.pptx`;
}

/**
 * On-disk path where the deck-build job writes the .pptx (EC2 local disk, served
 * via the authenticated route — no Drive). Under config.paths.data/decks.
 */
export function deckPptxDiskPath(mandalaId: string): string {
  return path.join(config.paths.data, 'decks', `${mandalaId}.pptx`);
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
