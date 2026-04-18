import { createClient } from "jsr:@supabase/supabase-js@2";

/** Hosts that serve images/thumbnails — never valid as card URLs */
const BLOCKED_CARD_HOSTS = [
  'img.youtube.com', 'i.ytimg.com', 'i1.ytimg.com', 'i2.ytimg.com',
  'i3.ytimg.com', 'i4.ytimg.com', 'yt3.ggpht.com', 'lh3.googleusercontent.com',
];

/** Validate URL is not empty and not a blocked CDN host. Returns error string or null. */
function validateCardUrl(url: string): string | null {
  if (!url || !url.trim()) return 'URL is empty';
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    if (BLOCKED_CARD_HOSTS.some(h => hostname === h || hostname.endsWith('.' + h))) {
      return `Blocked host: ${hostname}. Thumbnail/CDN URLs cannot be saved as cards.`;
    }
  } catch {
    return 'Invalid URL format';
  }
  return null;
}

const ALLOWED_ORIGINS = [
  'https://insighta.one',
  'https://www.insighta.one',
  'http://localhost:8081',
  'http://localhost:5173',
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get('origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Vary': 'Origin',
  };
}

// Helper: Get or create subscription record
async function getOrCreateSubscription(supabase: ReturnType<typeof createClient>, userId: string) {
  let { data: subscription, error } = await supabase
    .from('user_subscriptions')
    .select('*')
    .eq('user_id', userId)
    .single();

  if (error && error.code === 'PGRST116') {
    const { data: newSub, error: insertError } = await supabase
      .from('user_subscriptions')
      // SSOT: docs/policies/quota-policy.md § Tier Definitions & Resource Limits
      .insert({ user_id: userId, tier: 'free', local_cards_limit: 150, mandala_limit: 3 })
      .select()
      .single();

    if (insertError) throw insertError;
    subscription = newSub;
  } else if (error) {
    throw error;
  }

  return subscription;
}

// Helper: Check card limit
async function checkCardLimit(supabase: ReturnType<typeof createClient>, userId: string) {
  const subscription = await getOrCreateSubscription(supabase, userId);

  const { count, error } = await supabase
    .from('user_local_cards')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);

  if (error) throw error;

  return {
    limit: subscription.local_cards_limit,
    used: count || 0,
    canAdd: (count || 0) < subscription.local_cards_limit,
    tier: subscription.tier
  };
}

// Helper: Post-insert verification — rollback if quota exceeded (prevents TOCTOU race)
async function verifyCardLimitAfterInsert(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  insertedCardIds: string[]
): Promise<{ exceeded: boolean; limitInfo?: { tier: string; limit: number; used: number } }> {
  const limitInfo = await checkCardLimit(supabase, userId);
  if (limitInfo.used <= limitInfo.limit) {
    return { exceeded: false };
  }

  // Over limit — delete the just-inserted cards to compensate
  if (insertedCardIds.length > 0) {
    await supabase
      .from('user_local_cards')
      .delete()
      .in('id', insertedCardIds)
      .eq('user_id', userId);
  }

  return { exceeded: true, limitInfo };
}

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

// Helper: Get YouTube access token (OAuth) for a user
async function getYouTubeAccessToken(supabase: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  const { data: settings } = await supabase
    .from('youtube_sync_settings')
    .select('youtube_access_token, youtube_token_expires_at')
    .eq('user_id', userId)
    .single();

  if (!settings?.youtube_access_token) return null;
  if (settings.youtube_token_expires_at) {
    const expiresAt = new Date(settings.youtube_token_expires_at);
    if (expiresAt < new Date()) return null;
  }
  return settings.youtube_access_token;
}

// Helper: Make YouTube API request (OAuth token or API key)
async function youtubeRequest(url: string, accessToken: string | null, apiKey: string | null): Promise<Response> {
  if (accessToken) {
    return fetch(url, { headers: { 'Authorization': `Bearer ${accessToken}` } });
  }
  const separator = url.includes('?') ? '&' : '?';
  return fetch(`${url}${separator}key=${apiKey}`);
}

// Helper: Extract playlist ID from URL
function extractPlaylistId(input: string): string | null {
  try {
    const parsed = new URL(input);
    return parsed.searchParams.get('list');
  } catch {
    if (/^[A-Za-z0-9_-]+$/.test(input) && input.length > 10) return input;
    return null;
  }
}

// Helper: Parse ISO 8601 duration to seconds
function parseDuration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  return parseInt(match[1] || '0', 10) * 3600 + parseInt(match[2] || '0', 10) * 60 + parseInt(match[3] || '0', 10);
}

// URL normalization for duplicate prevention
const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);
const GENERIC_TRACKING = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'ref', 'source', 'mc_cid', 'mc_eid',
]);
const YT_TRACKING = new Set(['list', 'index', 't', 'si', 'feature', 'pp', 'ab_channel', 'app', 'src_vid']);

function normalizeUrl(rawUrl: string): string {
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { return rawUrl; }

  const host = parsed.hostname.replace(/^www\./, '');
  const isYT = YOUTUBE_HOSTS.has(parsed.hostname) || YOUTUBE_HOSTS.has(host) || host === 'youtu.be';

  if (isYT) {
    let videoId: string | null = null;
    if (host === 'youtu.be') {
      videoId = parsed.pathname.slice(1).split('/')[0] || null;
    } else {
      const shortsMatch = parsed.pathname.match(/^\/shorts\/([^/?#]+)/);
      if (shortsMatch) return `https://www.youtube.com/shorts/${shortsMatch[1]}`;
      videoId = parsed.searchParams.get('v');
      if (!videoId) {
        const embedMatch = parsed.pathname.match(/^\/embed\/([^/?#]+)/);
        if (embedMatch) videoId = embedMatch[1];
      }
    }
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
    return rawUrl;
  }

  // Generic normalization
  parsed.hostname = parsed.hostname.toLowerCase();
  for (const p of GENERIC_TRACKING) parsed.searchParams.delete(p);
  for (const p of YT_TRACKING) parsed.searchParams.delete(p);
  parsed.searchParams.sort();
  if (parsed.pathname.endsWith('/') && parsed.pathname.length > 1) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }
  parsed.hash = '';
  return parsed.toString();
}

console.log("local-cards Edge Function loaded");

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  console.log('[local-cards]', req.method, new URL(req.url).searchParams.get('action'));

  // Get user from authorization header
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: 'Authorization required' }),
      { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);

  if (userError || !user) {
    console.error('[local-cards] Auth failed:', userError?.message);
    return new Response(
      JSON.stringify({ error: 'Invalid user token' }),
      { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    switch (action) {
      case 'list': {
        const mandalaId = url.searchParams.get('mandala_id');

        // Parallel fetch: subscription + cards
        let cardsQuery = supabase
          .from('user_local_cards')
          .select('*')
          .eq('user_id', user.id)
          .order('sort_order', { ascending: true });

        if (mandalaId) {
          cardsQuery = cardsQuery.eq('mandala_id', mandalaId);
        }

        const [subscription, cardsResult] = await Promise.all([
          getOrCreateSubscription(supabase, user.id),
          cardsQuery,
        ]);

        if (cardsResult.error) throw cardsResult.error;

        const cards = cardsResult.data || [];

        // Enrich YouTube cards with video_summaries (LEFT JOIN equivalent)
        const youtubeCards = cards.filter(
          (c: Record<string, unknown>) => c.link_type === 'youtube' || c.link_type === 'youtube-shorts'
        );
        const youtubeUrls = youtubeCards.map((c: Record<string, unknown>) => c.url as string);
        const youtubeVideoIds = youtubeCards
          .map((c: Record<string, unknown>) => c.video_id as string | null)
          .filter((id): id is string => !!id);

        let summaryMap = new Map<string, Record<string, unknown>>();
        let videoMetaMap = new Map<string, { published_at: string | null; duration_seconds: number | null }>();
        if (youtubeUrls.length > 0 || youtubeVideoIds.length > 0) {
          const [summariesRes, videosRes] = await Promise.all([
            youtubeUrls.length > 0
              ? supabase
                  .from('video_summaries')
                  .select('url, summary_en, summary_ko, tags, model')
                  .in('url', youtubeUrls)
              : Promise.resolve({ data: [] as Record<string, unknown>[] }),
            youtubeVideoIds.length > 0
              ? supabase
                  .from('youtube_videos')
                  .select('youtube_video_id, published_at, duration_seconds')
                  .in('youtube_video_id', youtubeVideoIds)
              : Promise.resolve({ data: [] as Record<string, unknown>[] }),
          ]);

          const summaries = (summariesRes as { data?: Record<string, unknown>[] }).data ?? [];
          for (const s of summaries) summaryMap.set(s.url as string, s);

          const videos = (videosRes as { data?: Record<string, unknown>[] }).data ?? [];
          for (const v of videos) {
            videoMetaMap.set(v.youtube_video_id as string, {
              published_at: (v.published_at as string | null) ?? null,
              duration_seconds: (v.duration_seconds as number | null) ?? null,
            });
          }
        }

        const enrichedCards = cards.map((card: Record<string, unknown>) => {
          const summary = summaryMap.get(card.url as string);
          const videoMeta = card.video_id ? videoMetaMap.get(card.video_id as string) : undefined;
          return {
            ...card,
            ...(summary ? { video_summary: summary } : {}),
            ...(videoMeta
              ? {
                  published_at: videoMeta.published_at,
                  duration_seconds: videoMeta.duration_seconds,
                }
              : {}),
          };
        });

        return new Response(
          JSON.stringify({
            cards: enrichedCards,
            subscription: {
              tier: subscription.tier,
              limit: subscription.local_cards_limit,
              mandalaLimit: subscription.mandala_limit,
              used: cards.length
            }
          }),
          { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      case 'add': {
        const body = await req.json();
        // Normalize URL before limit check and upsert to prevent duplicates from URL variants
        if (body.url) body.url = normalizeUrl(body.url);
        const limitInfo = await checkCardLimit(supabase, user.id);

        if (!limitInfo.canAdd) {
          return new Response(
            JSON.stringify({
              error: 'LIMIT_EXCEEDED',
              message: `${limitInfo.tier} tier limit (${limitInfo.limit}) exceeded`,
              tier: limitInfo.tier,
              limit: limitInfo.limit,
              used: limitInfo.used
            }),
            { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        if (!body.url || !body.link_type) {
          return new Response(
            JSON.stringify({ error: 'url and link_type are required' }),
            { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        // Structural validation — block thumbnail/CDN URLs from becoming cards
        const urlError = validateCardUrl(body.url);
        if (urlError) {
          return new Response(
            JSON.stringify({ error: 'INVALID_URL', message: urlError }),
            { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        // Validate cell_index range (matches DB CHECK constraint)
        const cellIndex = body.cell_index ?? -1;
        if (cellIndex < -1 || cellIndex >= 9) {
          return new Response(
            JSON.stringify({ error: 'INVALID_CELL_INDEX', message: `cell_index must be >= -1 and < 9, got ${cellIndex}` }),
            { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        // Resolve mandala_id: use provided value, or fall back to user's default mandala
        // for non-scratchpad cards (prevents NULL when frontend sends during init race)
        let resolvedMandalaId = body.mandala_id ?? null;
        const isNonScratchpad = (body.cell_index ?? -1) >= 0 && body.level_id && body.level_id !== 'scratchpad';
        if (!resolvedMandalaId && isNonScratchpad) {
          const { data: defaultMandala } = await supabase
            .from('user_mandalas')
            .select('id')
            .eq('user_id', user.id)
            .eq('is_default', true)
            .single();
          if (defaultMandala) {
            resolvedMandalaId = defaultMandala.id;
            console.log('[local-cards] add: mandala_id was null for non-scratchpad card, resolved to default:', resolvedMandalaId);
          }
        }

        // Check if card with same URL already exists (detect update vs create)
        const { data: existingCard } = await supabase
          .from('user_local_cards')
          .select('id')
          .eq('user_id', user.id)
          .eq('url', body.url)
          .maybeSingle();

        const isUpdate = !!existingCard;

        const { data: card, error: upsertError } = await supabase
          .from('user_local_cards')
          .upsert({
            user_id: user.id,
            url: body.url,
            title: body.title ?? null,
            thumbnail: body.thumbnail ?? null,
            link_type: body.link_type,
            user_note: body.user_note ?? '',
            metadata_title: body.metadata_title ?? null,
            metadata_description: body.metadata_description ?? null,
            metadata_image: body.metadata_image ?? null,
            cell_index: body.cell_index ?? -1,
            level_id: body.level_id ?? 'scratchpad',
            sort_order: body.sort_order ?? null,
            mandala_id: resolvedMandalaId,
          }, { onConflict: 'user_id,url' })
          .select()
          .single();

        if (upsertError) {
          throw upsertError;
        }

        // Post-insert verification: rollback if quota race occurred
        if (card?.id) {
          const verification = await verifyCardLimitAfterInsert(supabase, user.id, [card.id]);
          if (verification.exceeded && verification.limitInfo) {
            return new Response(
              JSON.stringify({
                error: 'LIMIT_EXCEEDED',
                message: `${verification.limitInfo.tier} tier limit (${verification.limitInfo.limit}) exceeded`,
                tier: verification.limitInfo.tier,
                limit: verification.limitInfo.limit,
                used: verification.limitInfo.used
              }),
              { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
            );
          }
        }

        return new Response(
          JSON.stringify({ card, isUpdate }),
          { status: isUpdate ? 200 : 201, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      case 'update': {
        const body = await req.json();
        const { id, ...updates } = body;

        if (!id) {
          return new Response(
            JSON.stringify({ error: 'Card id is required' }),
            { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        const allowedFields = [
          'title', 'thumbnail', 'user_note', 'metadata_title',
          'metadata_description', 'metadata_image', 'cell_index',
          'level_id', 'sort_order', 'mandala_id'
        ];

        // Validate cell_index if provided
        if (updates.cell_index !== undefined && (updates.cell_index < -1 || updates.cell_index >= 9)) {
          return new Response(
            JSON.stringify({ error: 'INVALID_CELL_INDEX', message: `cell_index must be >= -1 and < 9, got ${updates.cell_index}` }),
            { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        const safeUpdates: Record<string, unknown> = {};
        for (const field of allowedFields) {
          if (updates[field] !== undefined) {
            safeUpdates[field] = updates[field];
          }
        }

        if (Object.keys(safeUpdates).length === 0) {
          return new Response(
            JSON.stringify({ error: 'No valid fields to update' }),
            { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        const { data: card, error: updateError } = await supabase
          .from('user_local_cards')
          .update(safeUpdates)
          .eq('id', id)
          .eq('user_id', user.id)
          .select()
          .single();

        if (updateError) throw updateError;

        if (!card) {
          return new Response(
            JSON.stringify({ error: 'Card not found' }),
            { status: 404, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ card }),
          { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      case 'delete': {
        const body = await req.json();
        const { id } = body;

        if (!id) {
          return new Response(
            JSON.stringify({ error: 'Card id is required' }),
            { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        const { error: deleteError } = await supabase
          .from('user_local_cards')
          .delete()
          .eq('id', id)
          .eq('user_id', user.id);

        if (deleteError) throw deleteError;

        return new Response(
          JSON.stringify({ success: true }),
          { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      case 'batch-move': {
        const body = await req.json();
        const { updates, inserts } = body;

        if (!Array.isArray(updates) && !Array.isArray(inserts)) {
          return new Response(
            JSON.stringify({ error: 'updates or inserts array is required' }),
            { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        const result: { updated: unknown[], inserted: unknown[] } = { updated: [], inserted: [] };

        // Process updates (existing cards position change)
        if (updates && updates.length > 0) {
          const allowedFields = ['cell_index', 'level_id', 'sort_order', 'mandala_id'];
          const updateResults = await Promise.all(updates.map(async (item: { id: string; cell_index?: number; level_id?: string; sort_order?: number }) => {
            const safeUpdates: Record<string, unknown> = {};
            for (const field of allowedFields) {
              if ((item as Record<string, unknown>)[field] !== undefined) {
                safeUpdates[field] = (item as Record<string, unknown>)[field];
              }
            }
            if (Object.keys(safeUpdates).length === 0) return null;

            const { data, error } = await supabase
              .from('user_local_cards')
              .update(safeUpdates)
              .eq('id', item.id)
              .eq('user_id', user.id)
              .select()
              .single();

            if (error) {
              console.error('[local-cards] batch-move update error:', error);
              return null;
            }
            return data;
          }));
          result.updated = updateResults.filter(Boolean);
        }

        // Process inserts (pending cards → persist)
        if (inserts && inserts.length > 0) {
          // Validate all insert URLs against blocked hosts
          const CELL_INDEX_MIN = -1;
          const CELL_INDEX_MAX = 8;
          for (const item of inserts) {
            const urlErr = validateCardUrl(item.url);
            if (urlErr) {
              return new Response(
                JSON.stringify({ error: 'INVALID_URL', message: urlErr }),
                { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
              );
            }
            const ci = item.cell_index ?? -1;
            if (ci < CELL_INDEX_MIN || ci > CELL_INDEX_MAX) {
              return new Response(
                JSON.stringify({ error: 'INVALID_CELL_INDEX', message: `cell_index must be ${CELL_INDEX_MIN}..${CELL_INDEX_MAX}` }),
                { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
              );
            }
          }

          // Check limit for inserts
          const limitInfo = await checkCardLimit(supabase, user.id);
          if (limitInfo.used + inserts.length > limitInfo.limit) {
            return new Response(
              JSON.stringify({
                error: 'LIMIT_EXCEEDED',
                message: `${limitInfo.tier} tier limit (${limitInfo.limit}) would be exceeded`,
                tier: limitInfo.tier,
                limit: limitInfo.limit,
                used: limitInfo.used
              }),
              { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
            );
          }

          const rows = inserts.map((item: { url: string; title?: string; thumbnail?: string; link_type?: string; user_note?: string; cell_index?: number; level_id?: string; sort_order?: number; mandala_id?: string }) => ({
            user_id: user.id,
            url: normalizeUrl(item.url),
            title: item.title ?? null,
            thumbnail: item.thumbnail ?? null,
            link_type: item.link_type ?? 'other',
            user_note: item.user_note ?? '',
            cell_index: item.cell_index ?? -1,
            level_id: item.level_id ?? 'scratchpad',
            sort_order: item.sort_order ?? null,
            mandala_id: item.mandala_id ?? null,
          }));

          const { data: insertedCards, error: insertError } = await supabase
            .from('user_local_cards')
            .insert(rows)
            .select();

          if (insertError) {
            console.error('[local-cards] batch-move insert error:', insertError);
            throw insertError;
          }
          result.inserted = insertedCards || [];

          // Post-insert verification: rollback if quota race occurred
          const insertedIds = (insertedCards || []).map((c: { id: string }) => c.id);
          if (insertedIds.length > 0) {
            const verification = await verifyCardLimitAfterInsert(supabase, user.id, insertedIds);
            if (verification.exceeded && verification.limitInfo) {
              return new Response(
                JSON.stringify({
                  error: 'LIMIT_EXCEEDED',
                  message: `${verification.limitInfo.tier} tier limit (${verification.limitInfo.limit}) exceeded (rolled back)`,
                  tier: verification.limitInfo.tier,
                  limit: verification.limitInfo.limit,
                  used: verification.limitInfo.used
                }),
                { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
              );
            }
          }
        }

        return new Response(
          JSON.stringify(result),
          { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      case 'import-playlist': {
        const body = await req.json();
        let { playlistUrl, cellIndex = -1, levelId = 'scratchpad', mandala_id = null } = body;

        // Resolve mandala_id for non-scratchpad cards (same fallback as 'add' action)
        const isPlaylistNonScratchpad = cellIndex >= 0 && levelId && levelId !== 'scratchpad';
        if (!mandala_id && isPlaylistNonScratchpad) {
          const { data: defaultMandala } = await supabase
            .from('user_mandalas')
            .select('id')
            .eq('user_id', user.id)
            .eq('is_default', true)
            .single();
          if (defaultMandala) {
            mandala_id = defaultMandala.id;
            console.log('[local-cards] import-playlist: mandala_id was null for non-scratchpad, resolved to default:', mandala_id);
          }
        }

        if (!playlistUrl) {
          return new Response(
            JSON.stringify({ error: 'playlistUrl is required' }),
            { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        const playlistId = extractPlaylistId(playlistUrl);
        if (!playlistId) {
          return new Response(
            JSON.stringify({ error: 'Invalid playlist URL' }),
            { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        // Dual auth: OAuth token (private playlists) or API key (public only)
        const accessToken = await getYouTubeAccessToken(supabase, user.id);
        const apiKey = Deno.env.get('YOUTUBE_API_KEY') || null;

        if (!accessToken && !apiKey) {
          return new Response(
            JSON.stringify({ error: 'No YouTube credentials available' }),
            { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        // 1. Fetch playlist metadata
        const plMetaUrl = `${YOUTUBE_API_BASE}/playlists?part=snippet,contentDetails&id=${playlistId}`;
        const plMetaResp = await youtubeRequest(plMetaUrl, accessToken, apiKey);

        if (!plMetaResp.ok) {
          const status = plMetaResp.status;
          if (status === 403 || status === 404) {
            return new Response(
              JSON.stringify({ error: accessToken ? 'PRIVATE_PLAYLIST_NOT_OWNER' : 'PRIVATE_PLAYLIST_NO_AUTH' }),
              { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
            );
          }
          throw new Error(`YouTube API error: ${status}`);
        }

        const plMetaData = await plMetaResp.json();
        if (!plMetaData.items || plMetaData.items.length === 0) {
          return new Response(
            JSON.stringify({ error: accessToken ? 'PRIVATE_PLAYLIST_NOT_OWNER' : 'PRIVATE_PLAYLIST_NO_AUTH' }),
            { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        const plMeta = plMetaData.items[0];
        const playlistTitle = plMeta.snippet.title;
        const playlistThumbnail = plMeta.snippet.thumbnails?.medium?.url || plMeta.snippet.thumbnails?.default?.url || '';
        const playlistItemCount = plMeta.contentDetails?.itemCount || 0;

        // 2. Card limit pre-check
        const limitInfo = await checkCardLimit(supabase, user.id);
        if (limitInfo.used + playlistItemCount > limitInfo.limit) {
          const available = Math.max(0, limitInfo.limit - limitInfo.used);
          return new Response(
            JSON.stringify({
              error: 'LIMIT_EXCEEDED',
              message: `Would exceed ${limitInfo.tier} tier limit (${limitInfo.limit})`,
              tier: limitInfo.tier,
              limit: limitInfo.limit,
              used: limitInfo.used,
              available,
            }),
            { status: 403, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        // 3. Fetch all playlist items (paginated, 50/page)
        const playlistItems: Array<{ videoId: string; position: number }> = [];
        let pageToken: string | undefined;
        let quotaUsed = 1; // playlists.list = 1 unit

        do {
          const piUrl = new URL(`${YOUTUBE_API_BASE}/playlistItems`);
          piUrl.searchParams.set('part', 'snippet,contentDetails');
          piUrl.searchParams.set('playlistId', playlistId);
          piUrl.searchParams.set('maxResults', '50');
          if (pageToken) piUrl.searchParams.set('pageToken', pageToken);

          const piResp = await youtubeRequest(piUrl.toString(), accessToken, apiKey);
          if (!piResp.ok) throw new Error('Failed to fetch playlist items');
          quotaUsed++;

          const piData = await piResp.json();
          for (const item of piData.items || []) {
            if (item.contentDetails?.videoId) {
              playlistItems.push({
                videoId: item.contentDetails.videoId,
                position: item.snippet?.position ?? playlistItems.length,
              });
            }
          }
          pageToken = piData.nextPageToken;
        } while (pageToken);

        // 4. Fetch video details in batches of 50
        const videoDetailsMap = new Map<string, { title: string; thumbnail: string; duration: number; channelTitle: string }>();
        const videoIds = playlistItems.map(i => i.videoId);

        for (let i = 0; i < videoIds.length; i += 50) {
          const batch = videoIds.slice(i, i + 50);
          const vUrl = `${YOUTUBE_API_BASE}/videos?part=snippet,contentDetails&id=${batch.join(',')}`;
          const vResp = await youtubeRequest(vUrl, accessToken, apiKey);
          if (!vResp.ok) throw new Error('Failed to fetch video details');
          quotaUsed++;

          const vData = await vResp.json();
          for (const v of vData.items || []) {
            videoDetailsMap.set(v.id, {
              title: v.snippet.title,
              thumbnail: v.snippet.thumbnails?.medium?.url || v.snippet.thumbnails?.default?.url || '',
              duration: parseDuration(v.contentDetails?.duration || 'PT0S'),
              channelTitle: v.snippet.channelTitle,
            });
          }
        }

        // 5. Bulk insert cards into user_local_cards
        const cardRows = playlistItems
          .map((item, idx) => {
            const details = videoDetailsMap.get(item.videoId);
            if (!details) return null;
            return {
              user_id: user.id,
              url: `https://www.youtube.com/watch?v=${item.videoId}`,
              title: details.title,
              thumbnail: details.thumbnail,
              link_type: 'youtube',
              user_note: '',
              cell_index: cellIndex,
              level_id: levelId,
              mandala_id: mandala_id,
              sort_order: idx,
            };
          })
          .filter(Boolean);

        let cardsCreated = 0;
        const createdCards: Array<{ id: string; url: string }> = [];
        if (cardRows.length > 0) {
          // Insert in batches to avoid hitting payload limits
          for (let i = 0; i < cardRows.length; i += 50) {
            const batch = cardRows.slice(i, i + 50);
            const { data: inserted, error: insertError } = await supabase
              .from('user_local_cards')
              .upsert(batch as Record<string, unknown>[], { onConflict: 'user_id,url' })
              .select('id, url');

            if (insertError) {
              console.error('[local-cards] import-playlist insert error:', insertError);
            } else {
              cardsCreated += (inserted?.length || 0);
              for (const card of inserted || []) {
                createdCards.push({ id: card.id, url: card.url });
              }
            }
          }
        }

        // 6. Upsert playlist into youtube_playlists (Settings > YouTube integration)
        await supabase
          .from('youtube_playlists')
          .upsert({
            user_id: user.id,
            youtube_playlist_id: playlistId,
            youtube_playlist_url: playlistUrl,
            title: playlistTitle,
            thumbnail_url: playlistThumbnail,
            channel_title: plMeta.snippet.channelTitle || '',
            description: plMeta.snippet.description || '',
            item_count: playlistItemCount,
            sync_status: 'completed',
            last_synced_at: new Date().toISOString(),
          }, { onConflict: 'user_id,youtube_playlist_id' });

        return new Response(
          JSON.stringify({
            success: true,
            playlist: { id: playlistId, title: playlistTitle, itemCount: playlistItemCount },
            cardsCreated,
            cards: createdCards,
            quotaUsed,
            limitInfo: {
              tier: limitInfo.tier,
              limit: limitInfo.limit,
              used: limitInfo.used,
              remaining: limitInfo.limit - limitInfo.used - cardsCreated,
            },
          }),
          { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      case 'search': {
        const query = url.searchParams.get('q')?.trim();
        if (!query || query.length === 0) {
          return new Response(
            JSON.stringify({ cards: [], total: 0 }),
            { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        const limit = Math.min(parseInt(url.searchParams.get('limit') || '30', 10), 50);
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);

        // ILIKE search across title, user_note, url, metadata_title, metadata_description
        const searchPattern = `%${query}%`;
        const { data: searchResults, error: searchError, count: totalCount } = await supabase
          .from('user_local_cards')
          .select('*', { count: 'exact' })
          .eq('user_id', user.id)
          .or(
            `title.ilike.${searchPattern},` +
            `user_note.ilike.${searchPattern},` +
            `url.ilike.${searchPattern},` +
            `metadata_title.ilike.${searchPattern},` +
            `metadata_description.ilike.${searchPattern}`
          )
          .order('created_at', { ascending: false })
          .range(offset, offset + limit - 1);

        if (searchError) throw searchError;

        return new Response(
          JSON.stringify({ cards: searchResults || [], total: totalCount || 0 }),
          { status: 200, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action. Use: list, add, update, delete, batch-move, import-playlist, search' }),
          { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[local-cards] Error:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});
