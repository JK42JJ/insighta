import { createClient } from "jsr:@supabase/supabase-js@2";

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

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

async function getYouTubeAccessToken(supabase: ReturnType<typeof createClient>, userId: string): Promise<string | null> {
  const { data: settings } = await supabase
    .from('youtube_sync_settings')
    .select('youtube_access_token, youtube_token_expires_at')
    .eq('user_id', userId)
    .single();

  if (!settings?.youtube_access_token) {
    return null;
  }

  if (settings.youtube_token_expires_at) {
    const expiresAt = new Date(settings.youtube_token_expires_at);
    if (expiresAt < new Date()) {
      return null;
    }
  }

  return settings.youtube_access_token;
}

function parsePlaylistId(input: string): string | null {
  if (/^[A-Za-z0-9_-]+$/.test(input) && input.length > 10) {
    return input;
  }
  try {
    const url = new URL(input);
    return url.searchParams.get('list');
  } catch {
    return null;
  }
}

async function fetchPlaylistDetails(accessToken: string, playlistId: string) {
  const response = await fetch(
    `${YOUTUBE_API_BASE}/playlists?part=snippet,contentDetails&id=${playlistId}`,
    { headers: { 'Authorization': `Bearer ${accessToken}` } }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error('YouTube API error:', errorText);
    throw new Error('Failed to fetch playlist from YouTube');
  }

  const data = await response.json();
  if (!data.items || data.items.length === 0) {
    throw new Error('Playlist not found');
  }

  const playlist = data.items[0];
  return {
    youtube_playlist_id: playlist.id,
    title: playlist.snippet.title,
    description: playlist.snippet.description || '',
    thumbnail_url: playlist.snippet.thumbnails?.medium?.url || playlist.snippet.thumbnails?.default?.url || '',
    channel_title: playlist.snippet.channelTitle,
    item_count: playlist.contentDetails?.itemCount || 0,
  };
}

async function fetchPlaylistItems(accessToken: string, playlistId: string): Promise<Array<{ videoId: string; position: number }>> {
  const items: Array<{ videoId: string; position: number }> = [];
  let pageToken: string | undefined;

  do {
    const url = new URL(`${YOUTUBE_API_BASE}/playlistItems`);
    url.searchParams.set('part', 'snippet,contentDetails');
    url.searchParams.set('playlistId', playlistId);
    url.searchParams.set('maxResults', '50');
    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const response = await fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch playlist items');
    }

    const data = await response.json();

    for (const item of data.items || []) {
      if (item.contentDetails?.videoId) {
        items.push({
          videoId: item.contentDetails.videoId,
          position: item.snippet?.position || items.length,
        });
      }
    }

    pageToken = data.nextPageToken;
  } while (pageToken);

  return items;
}

async function fetchVideoDetails(accessToken: string, videoIds: string[]) {
  const videos = new Map();

  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const response = await fetch(
      `${YOUTUBE_API_BASE}/videos?part=snippet,contentDetails,statistics&id=${batch.join(',')}`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } }
    );

    if (!response.ok) {
      throw new Error('Failed to fetch video details');
    }

    const data = await response.json();

    for (const video of data.items || []) {
      videos.set(video.id, {
        youtube_video_id: video.id,
        title: video.snippet.title,
        description: video.snippet.description || '',
        thumbnail_url: video.snippet.thumbnails?.medium?.url || video.snippet.thumbnails?.default?.url || '',
        channel_title: video.snippet.channelTitle,
        duration_seconds: parseDuration(video.contentDetails?.duration || 'PT0S'),
        published_at: video.snippet.publishedAt,
        view_count: parseInt(video.statistics?.viewCount || '0', 10),
        like_count: parseInt(video.statistics?.likeCount || '0', 10),
      });
    }
  }

  return videos;
}

function parseDuration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

console.log("youtube-sync Edge Function loaded");

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
    return new Response(
      JSON.stringify({ error: 'Invalid user token' }),
      { status: 401, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }

  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    switch (action) {
      case 'add-playlist': {
        const body = await req.json();
        const playlistUrl = body.playlistUrl;

        if (!playlistUrl) {
          return new Response(
            JSON.stringify({ error: 'Playlist URL is required' }),
            { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        const playlistId = parsePlaylistId(playlistUrl);
        if (!playlistId) {
          return new Response(
            JSON.stringify({ error: 'Invalid playlist URL' }),
            { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        const accessToken = await getYouTubeAccessToken(supabase, user.id);
        if (!accessToken) {
          return new Response(
            JSON.stringify({ error: 'YouTube account not connected or token expired' }),
            { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        const { data: existingPlaylist } = await supabase
          .from('youtube_playlists')
          .select('id')
          .eq('user_id', user.id)
          .eq('youtube_playlist_id', playlistId)
          .single();

        if (existingPlaylist) {
          return new Response(
            JSON.stringify({ error: 'Playlist already added' }),
            { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        const playlistDetails = await fetchPlaylistDetails(accessToken, playlistId);

        const { data: newPlaylist, error: insertError } = await supabase
          .from('youtube_playlists')
          .insert({
            user_id: user.id,
            youtube_playlist_id: playlistId,
            youtube_playlist_url: playlistUrl,
            title: playlistDetails.title,
            description: playlistDetails.description,
            thumbnail_url: playlistDetails.thumbnail_url,
            channel_title: playlistDetails.channel_title,
            item_count: playlistDetails.item_count,
            sync_status: 'pending',
          })
          .select()
          .single();

        if (insertError) {
          console.error('Failed to save playlist:', insertError);
          return new Response(
            JSON.stringify({ error: 'Failed to save playlist' }),
            { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ playlist: newPlaylist }),
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      case 'list-playlists': {
        const { data: playlists, error } = await supabase
          .from('youtube_playlists')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('Failed to list playlists:', error);
          return new Response(
            JSON.stringify({ error: 'Failed to list playlists' }),
            { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ playlists: playlists || [] }),
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      case 'sync-playlist': {
        const body = await req.json();
        const playlistId = body.playlistId;

        if (!playlistId) {
          return new Response(
            JSON.stringify({ error: 'Playlist ID is required' }),
            { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        const { data: playlist, error: playlistError } = await supabase
          .from('youtube_playlists')
          .select('*')
          .eq('id', playlistId)
          .eq('user_id', user.id)
          .single();

        if (playlistError || !playlist) {
          return new Response(
            JSON.stringify({ error: 'Playlist not found' }),
            { status: 404, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        const accessToken = await getYouTubeAccessToken(supabase, user.id);
        if (!accessToken) {
          return new Response(
            JSON.stringify({ error: 'YouTube account not connected or token expired' }),
            { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        await supabase
          .from('youtube_playlists')
          .update({ sync_status: 'syncing' })
          .eq('id', playlistId);

        const syncSteps: string[] = [];
        try {
          const playlistItems = await fetchPlaylistItems(accessToken, playlist.youtube_playlist_id);
          const videoIds = playlistItems.map(item => item.videoId);
          const videoDetails = await fetchVideoDetails(accessToken, videoIds);

          const { data: existingVideos } = await supabase
            .from('youtube_videos')
            .select('id, youtube_video_id')
            .in('youtube_video_id', videoIds);

          const existingVideoMap = new Map(
            (existingVideos || []).map(v => [v.youtube_video_id, v.id])
          );

          const newVideos: Array<{
            youtube_video_id: string; title: string; description: string;
            thumbnail_url: string; channel_title: string; duration_seconds: number;
            published_at: string; view_count: number; like_count: number;
          }> = [];

          for (const [videoId, details] of videoDetails) {
            if (!existingVideoMap.has(videoId)) {
              newVideos.push(details);
            }
          }

          if (newVideos.length > 0) {
            const { data: insertedVideos, error: insertError } = await supabase
              .from('youtube_videos')
              .upsert(newVideos, { onConflict: 'youtube_video_id' })
              .select('id, youtube_video_id');

            if (!insertError && insertedVideos) {
              for (const v of insertedVideos) {
                existingVideoMap.set(v.youtube_video_id, v.id);
              }
            }
          }

          const { data: currentItems } = await supabase
            .from('youtube_playlist_items')
            .select('id, video_id')
            .eq('playlist_id', playlistId)
            .is('removed_at', null);

          const currentVideoIds = new Set((currentItems || []).map(item => item.video_id));

          const newItems: Array<{ playlist_id: string; video_id: string; position: number }> = [];

          for (const item of playlistItems) {
            const videoDbId = existingVideoMap.get(item.videoId);
            if (videoDbId && !currentVideoIds.has(videoDbId)) {
              newItems.push({
                playlist_id: playlistId,
                video_id: videoDbId,
                position: item.position,
              });
            }
          }

          let itemsAdded = 0;

          if (newItems.length > 0) {
            const { error: itemsError } = await supabase
              .from('youtube_playlist_items')
              .upsert(newItems, { onConflict: 'playlist_id,video_id' });

            if (itemsError) {
              console.error('[youtube-sync] playlist_items upsert error:', itemsError);
              throw new Error(`playlist_items upsert failed: ${itemsError.message}`);
            }
            itemsAdded = newItems.length;
            syncSteps.push(`items_added:${itemsAdded}`);
          }

          // Add videos to ideation (user_video_states)
          const videoIdsToAddToIdeation: string[] = [];
          for (const item of playlistItems) {
            const videoDbId = existingVideoMap.get(item.videoId);
            if (videoDbId) {
              videoIdsToAddToIdeation.push(videoDbId);
            }
          }

          if (videoIdsToAddToIdeation.length > 0) {
            const { data: existingStates } = await supabase
              .from('user_video_states')
              .select('video_id')
              .eq('user_id', user.id)
              .in('video_id', videoIdsToAddToIdeation);

            const existingVideoStateIds = new Set(
              (existingStates || []).map(s => s.video_id)
            );

            const newVideoStates = videoIdsToAddToIdeation
              .filter(videoId => !existingVideoStateIds.has(videoId))
              .map((videoId, index) => ({
                user_id: user.id,
                video_id: videoId,
                is_in_ideation: true,
                sort_order: index,
              }));

            if (newVideoStates.length > 0) {
              const { error: statesError } = await supabase
                .from('user_video_states')
                .insert(newVideoStates);

              if (statesError) {
                console.error('[youtube-sync] video_states insert error:', statesError);
                throw new Error(`video_states insert failed: ${statesError.message}`);
              }
              syncSteps.push(`states_added:${newVideoStates.length}`);
            }
          }

          // Batch position update (replaces N+1 individual updates)
          const positionUpdates = playlistItems
            .map(item => {
              const videoDbId = existingVideoMap.get(item.videoId);
              return videoDbId ? { playlist_id: playlistId, video_id: videoDbId, position: item.position } : null;
            })
            .filter((u): u is { playlist_id: string; video_id: string; position: number } => u !== null);

          if (positionUpdates.length > 0) {
            const { error: posError } = await supabase
              .from('youtube_playlist_items')
              .upsert(positionUpdates, { onConflict: 'playlist_id,video_id' });

            if (posError) {
              console.error('[youtube-sync] position update error:', posError);
              throw new Error(`position update failed: ${posError.message}`);
            }
            syncSteps.push(`positions_updated:${positionUpdates.length}`);
          }

          // Mark removed items (soft delete)
          const currentYouTubeVideoIds = new Set(playlistItems.map(item => item.videoId));
          let itemsRemoved = 0;

          // Build removal list first, then batch update
          const itemsToRemove: string[] = [];
          for (const item of currentItems || []) {
            const { data: video } = await supabase
              .from('youtube_videos')
              .select('youtube_video_id')
              .eq('id', item.video_id)
              .single();

            if (video && !currentYouTubeVideoIds.has(video.youtube_video_id)) {
              itemsToRemove.push(item.id);
            }
          }

          if (itemsToRemove.length > 0) {
            const { error: removeError } = await supabase
              .from('youtube_playlist_items')
              .update({ removed_at: new Date().toISOString() })
              .in('id', itemsToRemove);

            if (removeError) {
              console.error('[youtube-sync] items removal error:', removeError);
              throw new Error(`items removal failed: ${removeError.message}`);
            }
            itemsRemoved = itemsToRemove.length;
            syncSteps.push(`items_removed:${itemsRemoved}`);
          }

          // Final status update
          const { error: statusError } = await supabase
            .from('youtube_playlists')
            .update({
              sync_status: 'completed',
              last_synced_at: new Date().toISOString(),
              item_count: playlistItems.length,
              sync_error: null,
            })
            .eq('id', playlistId);

          if (statusError) {
            console.error('[youtube-sync] status update error:', statusError);
            throw new Error(`status update failed: ${statusError.message}`);
          }

          return new Response(
            JSON.stringify({
              success: true,
              itemsAdded,
              itemsRemoved,
              totalItems: playlistItems.length,
              quotaUsed: Math.ceil(videoIds.length / 50) + Math.ceil(playlistItems.length / 50) + 1,
            }),
            { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        } catch (syncError) {
          console.error('[youtube-sync] Sync failed at steps:', syncSteps.join(' → '), 'error:', syncError);
          await supabase
            .from('youtube_playlists')
            .update({
              sync_status: 'failed',
              sync_error: syncError instanceof Error
                ? `${syncError.message} [completed: ${syncSteps.join(', ')}]`
                : `Unknown sync error [completed: ${syncSteps.join(', ')}]`,
            })
            .eq('id', playlistId);

          throw syncError;
        }
      }

      case 'delete-playlist': {
        const body = await req.json();
        const playlistId = body.playlistId;

        if (!playlistId) {
          return new Response(
            JSON.stringify({ error: 'Playlist ID is required' }),
            { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        const { error } = await supabase
          .from('youtube_playlists')
          .delete()
          .eq('id', playlistId)
          .eq('user_id', user.id);

        if (error) {
          console.error('Failed to delete playlist:', error);
          return new Response(
            JSON.stringify({ error: 'Failed to delete playlist' }),
            { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      case 'update-settings': {
        const body = await req.json();
        const { syncInterval, autoSyncEnabled } = body;

        const updates: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };

        if (syncInterval !== undefined) {
          updates.sync_interval = syncInterval;
        }
        if (autoSyncEnabled !== undefined) {
          updates.auto_sync_enabled = autoSyncEnabled;
        }

        const { error } = await supabase
          .from('youtube_sync_settings')
          .update(updates)
          .eq('user_id', user.id);

        if (error) {
          console.error('Failed to update settings:', error);
          return new Response(
            JSON.stringify({ error: 'Failed to update settings' }),
            { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      case 'get-ideation-videos': {
        const { data: videos, error } = await supabase
          .from('user_video_states')
          .select(`
            *,
            video:youtube_videos (*)
          `)
          .eq('user_id', user.id)
          .eq('is_in_ideation', true)
          .order('added_to_ideation_at', { ascending: false });

        if (error) {
          console.error('Failed to get ideation videos:', error);
          return new Response(
            JSON.stringify({ error: 'Failed to get ideation videos' }),
            { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ videos: videos || [] }),
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      case 'get-all-video-states': {
        const mandalaId = url.searchParams.get('mandala_id');
        let query = supabase
          .from('user_video_states')
          .select(`
            *,
            video:youtube_videos (*)
          `)
          .eq('user_id', user.id)
          .order('added_to_ideation_at', { ascending: false });

        if (mandalaId) {
          query = query.eq('mandala_id', mandalaId);
        }

        const { data, error } = await query;

        if (error) {
          console.error('Failed to get all video states:', error);
          return new Response(
            JSON.stringify({ error: 'Failed to get all video states' }),
            { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ videos: data || [] }),
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      case 'update-video-state': {
        const body = await req.json();
        const { videoStateId, updates } = body;

        if (!videoStateId) {
          return new Response(
            JSON.stringify({ error: 'Video state ID is required' }),
            { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        const allowedFields = [
          'is_in_ideation', 'user_note', 'watch_position_seconds',
          'is_watched', 'cell_index', 'level_id', 'sort_order', 'mandala_id',
        ];

        const safeUpdates: Record<string, unknown> = {
          updated_at: new Date().toISOString(),
        };

        for (const field of allowedFields) {
          if (updates[field] !== undefined) {
            safeUpdates[field] = updates[field];
          }
        }

        const { error } = await supabase
          .from('user_video_states')
          .update(safeUpdates)
          .eq('id', videoStateId)
          .eq('user_id', user.id);

        if (error) {
          console.error('Failed to update video state:', error);
          return new Response(
            JSON.stringify({ error: 'Failed to update video state' }),
            { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      case 'batch-update-video-state': {
        const body = await req.json();
        const { updates: batchUpdates } = body;

        if (!Array.isArray(batchUpdates) || batchUpdates.length === 0) {
          return new Response(
            JSON.stringify({ error: 'updates array is required' }),
            { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
          );
        }

        const allowedFields = [
          'is_in_ideation', 'user_note', 'watch_position_seconds',
          'is_watched', 'cell_index', 'level_id', 'sort_order', 'mandala_id',
        ];

        let updatedCount = 0;
        await Promise.all(batchUpdates.map(async (item: { videoStateId: string; updates: Record<string, unknown> }) => {
          const safeUpdates: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
          };

          for (const field of allowedFields) {
            if (item.updates[field] !== undefined) {
              safeUpdates[field] = item.updates[field];
            }
          }

          const { error } = await supabase
            .from('user_video_states')
            .update(safeUpdates)
            .eq('id', item.videoStateId)
            .eq('user_id', user.id);

          if (error) {
            console.error('[youtube-sync] batch-update-video-state error:', error);
          } else {
            updatedCount++;
          }
        }));

        return new Response(
          JSON.stringify({ success: true, updatedCount }),
          { headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
        );
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('YouTube sync error:', errorMessage);
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...getCorsHeaders(req), 'Content-Type': 'application/json' } }
    );
  }
});
