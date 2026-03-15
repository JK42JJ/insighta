import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
      .insert({ user_id: userId, tier: 'free', local_cards_limit: 100, mandala_limit: 3 })
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

console.log("local-cards Edge Function loaded");

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  console.log('[local-cards]', req.method, new URL(req.url).searchParams.get('action'));

  // Get user from authorization header
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: 'Authorization required' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);

  if (userError || !user) {
    console.error('[local-cards] Auth failed:', userError?.message);
    return new Response(
      JSON.stringify({ error: 'Invalid user token' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    switch (action) {
      case 'list': {
        const mandalaId = url.searchParams.get('mandala_id');

        // Parallel fetch: subscription + cards (was 3 sequential queries, now 2 parallel)
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

        return new Response(
          JSON.stringify({
            cards,
            subscription: {
              tier: subscription.tier,
              limit: subscription.local_cards_limit,
              mandalaLimit: subscription.mandala_limit,
              used: cards.length
            }
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'add': {
        const body = await req.json();
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
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!body.url || !body.link_type) {
          return new Response(
            JSON.stringify({ error: 'url and link_type are required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

        return new Response(
          JSON.stringify({ card }),
          { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update': {
        const body = await req.json();
        const { id, ...updates } = body;

        if (!id) {
          return new Response(
            JSON.stringify({ error: 'Card id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const allowedFields = [
          'title', 'thumbnail', 'user_note', 'metadata_title',
          'metadata_description', 'metadata_image', 'cell_index',
          'level_id', 'sort_order', 'mandala_id'
        ];

        const safeUpdates: Record<string, unknown> = {};
        for (const field of allowedFields) {
          if (updates[field] !== undefined) {
            safeUpdates[field] = updates[field];
          }
        }

        if (Object.keys(safeUpdates).length === 0) {
          return new Response(
            JSON.stringify({ error: 'No valid fields to update' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ card }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'delete': {
        const body = await req.json();
        const { id } = body;

        if (!id) {
          return new Response(
            JSON.stringify({ error: 'Card id is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'batch-move': {
        const body = await req.json();
        const { updates, inserts } = body;

        if (!Array.isArray(updates) && !Array.isArray(inserts)) {
          return new Response(
            JSON.stringify({ error: 'updates or inserts array is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
              { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }

          const rows = inserts.map((item: { url: string; title?: string; thumbnail?: string; link_type?: string; user_note?: string; cell_index?: number; level_id?: string; sort_order?: number; mandala_id?: string }) => ({
            user_id: user.id,
            url: item.url,
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
        }

        return new Response(
          JSON.stringify(result),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const playlistId = extractPlaylistId(playlistUrl);
        if (!playlistId) {
          return new Response(
            JSON.stringify({ error: 'Invalid playlist URL' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Dual auth: OAuth token (private playlists) or API key (public only)
        const accessToken = await getYouTubeAccessToken(supabase, user.id);
        const apiKey = Deno.env.get('YOUTUBE_API_KEY') || null;

        if (!accessToken && !apiKey) {
          return new Response(
            JSON.stringify({ error: 'No YouTube credentials available' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
              { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            );
          }
          throw new Error(`YouTube API error: ${status}`);
        }

        const plMetaData = await plMetaResp.json();
        if (!plMetaData.items || plMetaData.items.length === 0) {
          return new Response(
            JSON.stringify({ error: accessToken ? 'PRIVATE_PLAYLIST_NOT_OWNER' : 'PRIVATE_PLAYLIST_NO_AUTH' }),
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
            { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
        if (cardRows.length > 0) {
          // Insert in batches to avoid hitting payload limits
          for (let i = 0; i < cardRows.length; i += 50) {
            const batch = cardRows.slice(i, i + 50);
            const { data: inserted, error: insertError } = await supabase
              .from('user_local_cards')
              .upsert(batch as Record<string, unknown>[], { onConflict: 'user_id,url' })
              .select('id');

            if (insertError) {
              console.error('[local-cards] import-playlist insert error:', insertError);
            } else {
              cardsCreated += (inserted?.length || 0);
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
            quotaUsed,
            limitInfo: {
              tier: limitInfo.tier,
              limit: limitInfo.limit,
              used: limitInfo.used,
              remaining: limitInfo.limit - limitInfo.used - cardsCreated,
            },
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action. Use: list, add, update, delete, batch-move, import-playlist' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[local-cards] Error:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
