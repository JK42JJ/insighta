/**
 * Isolated fetch wrapper for the rich-note endpoints.
 *
 * Intentionally does NOT go through shared/lib/api-client.ts to minimize
 * merge conflicts with a parallel session editing that 14K-line file.
 * Uses the same auth helper (getAuthHeaders) and the same base URL resolution.
 */
import { getAuthHeaders } from '@/shared/lib/supabase-auth';
import type { TiptapDoc } from './note-parser';

// Use relative URL so requests go through the Vite proxy (/api → API server).
// This avoids cross-origin issues (401) that occur when fetching absolute
// http://localhost:3000 directly from http://localhost:8081.
const API_BASE_URL = '';

export interface RichNoteVideoMeta {
  id: string;
  title: string;
  channel: string | null;
  durationSec: number | null;
  thumbnail: string | null;
}

export interface RichNoteMandalaCell {
  mandalaId: string;
  cellIndex: number;
}

export interface RichNoteResponse {
  videoId: string;
  video: RichNoteVideoMeta;
  mandalaCell: RichNoteMandalaCell | null;
  note: TiptapDoc | null;
  isLegacy: boolean;
  updatedAt: string | null;
}

export interface SaveRichNoteResponse {
  updatedAt: string;
}

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = await getAuthHeaders();
  return fetch(`${API_BASE_URL}/api/v1${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...headers,
      ...(init?.headers ?? {}),
    },
  });
}

export async function fetchRichNote(cardId: string): Promise<RichNoteResponse> {
  const res = await authedFetch(`/rich-notes/${cardId}`);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`fetchRichNote failed: ${res.status} ${body}`);
  }
  return (await res.json()) as RichNoteResponse;
}

export async function saveRichNote(cardId: string, note: TiptapDoc): Promise<SaveRichNoteResponse> {
  const res = await authedFetch(`/rich-notes/${cardId}`, {
    method: 'PATCH',
    body: JSON.stringify({ note }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`saveRichNote failed: ${res.status} ${body}`);
  }
  return (await res.json()) as SaveRichNoteResponse;
}
