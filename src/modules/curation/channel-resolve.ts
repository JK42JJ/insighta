/**
 * Channel resolution for channel-based curation (P2).
 * Design: docs/design/curation-channel-subscription-2026-07-27.md §2-a, §4.
 *
 * Takes whatever a user pastes — a URL, an @handle, a bare channel id — and
 * returns the one thing the weekly build actually needs: the uploads playlist.
 *
 * It comes from the same `channels.list` response as the id, so the build never
 * derives it from the UC->UU convention. That convention happens to hold today
 * (verified 2026-07-27: @nomadcoders -> UCUpJs89fSBXNolQGOYKn0YQ, uploads
 * UUUpJs89fSBXNolQGOYKn0YQ), but it is not a documented guarantee and the call
 * that would tell us costs the same 1 unit either way.
 */

import { logger } from '@/utils/logger';

const log = logger.child({ module: 'channel-resolve' });

const API = 'https://www.googleapis.com/youtube/v3';

/** channels.list accepts at most 50 ids per call. */
export const CHANNEL_LOOKUP_BATCH = 50;

export interface ResolvedChannel {
  channelId: string;
  title: string | null;
  uploadsPlaylistId: string | null;
  thumbnailUrl: string | null;
}

/** What the user typed, reduced to something channels.list can accept. */
type ChannelRef =
  | { kind: 'id'; value: string }
  | { kind: 'handle'; value: string }
  | { kind: 'username'; value: string };

/** A channel id is always `UC` + 22 url-safe base64 chars. */
const CHANNEL_ID_RE = /^UC[\w-]{22}$/;

/**
 * Parse a pasted string into a lookup key. Pure — no network, so the parsing
 * rules are testable without a quota unit.
 *
 * Accepted:
 *   UCUpJs89fSBXNolQGOYKn0YQ
 *   @nomadcoders                       (with or without the @)
 *   https://youtube.com/@nomadcoders
 *   https://www.youtube.com/channel/UC.../videos
 *   https://youtube.com/c/SomeName     (legacy custom url -> treated as a handle)
 *   https://youtube.com/user/SomeName  (legacy username)
 */
export function parseChannelRef(input: string): ChannelRef | null {
  const raw = input.trim();
  if (!raw) return null;

  if (CHANNEL_ID_RE.test(raw)) return { kind: 'id', value: raw };
  if (raw.startsWith('@')) {
    const h = raw.slice(1).split(/[/?#]/)[0] ?? '';
    return h ? { kind: 'handle', value: h } : null;
  }

  // Anything URL-shaped: read the path, ignore the rest.
  const m = raw.match(/^(?:https?:\/\/)?(?:www\.|m\.)?youtube\.com\/(.+)$/i);
  if (m) {
    const segments = (m[1] ?? '').split(/[?#]/)[0]?.split('/').filter(Boolean) ?? [];
    const [first, second] = segments;
    if (!first) return null;
    if (first.startsWith('@')) {
      const h = first.slice(1);
      return h ? { kind: 'handle', value: h } : null;
    }
    if (first === 'channel' && second) {
      return CHANNEL_ID_RE.test(second) ? { kind: 'id', value: second } : null;
    }
    if (first === 'user' && second) return { kind: 'username', value: second };
    if (first === 'c' && second) return { kind: 'handle', value: second };
    return null;
  }

  // A bare word is most likely a handle typed without the @.
  if (/^[\w.-]{3,30}$/.test(raw)) return { kind: 'handle', value: raw };
  return null;
}

function paramFor(ref: ChannelRef): string {
  if (ref.kind === 'id') return `id=${encodeURIComponent(ref.value)}`;
  if (ref.kind === 'handle') return `forHandle=${encodeURIComponent(ref.value)}`;
  return `forUsername=${encodeURIComponent(ref.value)}`;
}

interface ChannelsListItem {
  id?: string;
  snippet?: { title?: string; thumbnails?: Record<string, { url?: string } | undefined> };
  contentDetails?: { relatedPlaylists?: { uploads?: string } };
}

function toResolved(item: ChannelsListItem): ResolvedChannel | null {
  if (!item.id) return null;
  const thumbs = item.snippet?.thumbnails ?? {};
  return {
    channelId: item.id,
    title: item.snippet?.title ?? null,
    uploadsPlaylistId: item.contentDetails?.relatedPlaylists?.uploads ?? null,
    thumbnailUrl: thumbs['medium']?.url ?? thumbs['default']?.url ?? null,
  };
}

/**
 * Resolve one pasted reference. Returns null when the input is unparseable or
 * the channel does not exist — the caller turns that into a 404/400, never into
 * a silently stored row.
 *
 * Cost: 1 unit.
 */
export async function resolveChannel(
  input: string,
  apiKeys: string[],
  fetchImpl: typeof fetch = fetch
): Promise<ResolvedChannel | null> {
  const ref = parseChannelRef(input);
  if (!ref) return null;
  const key = apiKeys[0];
  if (!key) {
    log.warn('no YouTube API key configured, channel resolution unavailable');
    return null;
  }

  const url = `${API}/channels?part=snippet,contentDetails&${paramFor(ref)}&key=${key}`;
  const res = await fetchImpl(url);
  if (!res.ok) {
    log.warn('channels.list failed', { status: res.status, kind: ref.kind });
    return null;
  }
  const json = (await res.json()) as { items?: ChannelsListItem[] };
  const first = json.items?.[0];
  return first ? toResolved(first) : null;
}

/**
 * Batch-resolve channel ids already known (the "pick from my subscriptions"
 * path, where the ids come from subscriptions.list). 1 unit per 50.
 */
export async function resolveChannelIds(
  channelIds: string[],
  apiKeys: string[],
  fetchImpl: typeof fetch = fetch
): Promise<Map<string, ResolvedChannel>> {
  const out = new Map<string, ResolvedChannel>();
  const ids = [...new Set(channelIds.filter((id) => CHANNEL_ID_RE.test(id)))];
  const key = apiKeys[0];
  if (ids.length === 0 || !key) return out;

  for (let i = 0; i < ids.length; i += CHANNEL_LOOKUP_BATCH) {
    const batch = ids.slice(i, i + CHANNEL_LOOKUP_BATCH);
    const url = `${API}/channels?part=snippet,contentDetails&id=${batch.join(',')}&key=${key}`;
    try {
      const res = await fetchImpl(url);
      if (!res.ok) {
        log.warn('channels.list batch failed', { status: res.status, size: batch.length });
        continue;
      }
      const json = (await res.json()) as { items?: ChannelsListItem[] };
      for (const item of json.items ?? []) {
        const r = toResolved(item);
        if (r) out.set(r.channelId, r);
      }
    } catch (err) {
      log.warn('channels.list batch threw', { error: (err as Error).message });
    }
  }
  return out;
}
