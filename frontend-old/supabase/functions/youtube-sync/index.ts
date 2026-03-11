import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';

interface YouTubePlaylistResponse {
  items: Array<{
    id: string;
    snippet: {
      title: string;
      description: string;
      thumbnails: {
        default?: { url: string };
        medium?: { url: string };
        high?: { url: string };
      };
      channelTitle: string;
    };
    contentDetails: {
      itemCount: number;
    };
  }>;
}

interface YouTubePlaylistItemsResponse {
  nextPageToken?: string;
  items: Array<{
    snippet: {
      position: number;
      resourceId: {
        videoId: string;
      };
    };
  }>;
}

interface YouTubeVideosResponse {
  items: Array<{
    id: string;
    snippet: {
      title: string;
      description: string;
      thumbnails: {
        default?: { url: string };
        medium?: { url: string };
        high?: { url: string };
      };
      channelTitle: string;
      publishedAt: string;
    };
    contentDetails: {
      duration: string;
    };
    statistics: {
      viewCount: string;
      likeCount: string;
    };
  }>;
}

// Parse ISO 8601 duration to seconds
function parseDuration(duration: string): number {
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0');
  const minutes = parseInt(match[2] || '0');
  const seconds = parseInt(match[3] || '0');
  return hours * 3600 + minutes * 60 + seconds;
}

// Extract playlist ID from URL
function extractPlaylistId(url: string): string | null {
  const patterns = [
    /[?&]list=([a-zA-Z0-9_-]+)/,
    /youtube\.com\/playlist\?list=([a-zA-Z0-9_-]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const youtubeApiKey = Deno.env.get('YOUTUBE_API_KEY');

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  // Get user from authorization header
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(
      JSON.stringify({ error: 'Authorization required' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: userError } = await supabase.auth.getUser(token);

  if (userError || !user) {
    return new Response(
      JSON.stringify({ error: 'Invalid user token' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    // Get user's YouTube access token or use API key
    const { data: settings } = await supabase
      .from('youtube_sync_settings')
      .select('youtube_access_token, youtube_token_expires_at')
      .eq('user_id', user.id)
      .single();

    const useOAuth = settings?.youtube_access_token &&
      settings?.youtube_token_expires_at &&
      new Date(settings.youtube_token_expires_at) > new Date();

    const accessToken = useOAuth ? settings.youtube_access_token : null;

    // Helper function to make YouTube API requests
    async function youtubeRequest<T>(endpoint: string, params: Record<string, string>): Promise<T> {
      const searchParams = new URLSearchParams(params);

      const headers: Record<string, string> = {};
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      } else if (youtubeApiKey) {
        searchParams.set('key', youtubeApiKey);
      } else {
        throw new Error('No YouTube API credentials available');
      }

      const response = await fetch(`${YOUTUBE_API_BASE}/${endpoint}?${searchParams}`, { headers });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`YouTube API error: ${response.status}`, errorText);
        throw new Error(`YouTube API error: ${response.status}`);
      }

      return response.json();
    }

    switch (action) {
      case 'add-playlist': {
        const body = await req.json();
        const { playlistUrl } = body;

        if (!playlistUrl) {
          return new Response(
            JSON.stringify({ error: 'Playlist URL is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const playlistId = extractPlaylistId(playlistUrl);
        if (!playlistId) {
          return new Response(
            JSON.stringify({ error: 'Invalid YouTube playlist URL' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Check if playlist already exists
        const { data: existing } = await supabase
          .from('youtube_playlists')
          .select('id')
          .eq('user_id', user.id)
          .eq('youtube_playlist_id', playlistId)
          .single();

        if (existing) {
          return new Response(
            JSON.stringify({ error: 'Playlist already added' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Fetch playlist metadata from YouTube
        const playlistData = await youtubeRequest<YouTubePlaylistResponse>('playlists', {
          part: 'snippet,contentDetails',
          id: playlistId,
        });

        if (!playlistData.items || playlistData.items.length === 0) {
          return new Response(
            JSON.stringify({ error: 'Playlist not found or is private' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const playlistInfo = playlistData.items[0];
        const thumbnailUrl = playlistInfo.snippet.thumbnails.high?.url ||
          playlistInfo.snippet.thumbnails.medium?.url ||
          playlistInfo.snippet.thumbnails.default?.url;

        // Insert playlist
        const { data: newPlaylist, error: insertError } = await supabase
          .from('youtube_playlists')
          .insert({
            user_id: user.id,
            youtube_playlist_id: playlistId,
            youtube_playlist_url: playlistUrl,
            title: playlistInfo.snippet.title,
            description: playlistInfo.snippet.description,
            thumbnail_url: thumbnailUrl,
            channel_title: playlistInfo.snippet.channelTitle,
            item_count: playlistInfo.contentDetails.itemCount,
            sync_status: 'pending',
          })
          .select()
          .single();

        if (insertError) {
          console.error('Failed to insert playlist:', insertError);
          return new Response(
            JSON.stringify({ error: 'Failed to add playlist' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, playlist: newPlaylist }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'sync-playlist': {
        const body = await req.json();
        const { playlistId: dbPlaylistId } = body;

        if (!dbPlaylistId) {
          return new Response(
            JSON.stringify({ error: 'Playlist ID is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Get playlist from database
        const { data: playlist, error: playlistError } = await supabase
          .from('youtube_playlists')
          .select('*')
          .eq('id', dbPlaylistId)
          .eq('user_id', user.id)
          .single();

        if (playlistError || !playlist) {
          return new Response(
            JSON.stringify({ error: 'Playlist not found' }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Update sync status
        await supabase
          .from('youtube_playlists')
          .update({ sync_status: 'syncing', sync_error: null })
          .eq('id', dbPlaylistId);

        // Create sync history entry
        const { data: syncHistory } = await supabase
          .from('youtube_sync_history')
          .insert({
            playlist_id: dbPlaylistId,
            status: 'started',
          })
          .select()
          .single();

        let itemsAdded = 0;
        let itemsRemoved = 0;
        let quotaUsed = 0;

        try {
          // Fetch all playlist items
          const allVideoIds: string[] = [];
          let nextPageToken: string | undefined;

          do {
            const params: Record<string, string> = {
              part: 'snippet',
              playlistId: playlist.youtube_playlist_id,
              maxResults: '50',
            };
            if (nextPageToken) params.pageToken = nextPageToken;

            const itemsData = await youtubeRequest<YouTubePlaylistItemsResponse>('playlistItems', params);
            quotaUsed += 1;

            for (const item of itemsData.items) {
              allVideoIds.push(item.snippet.resourceId.videoId);
            }

            nextPageToken = itemsData.nextPageToken;
          } while (nextPageToken);

          // Fetch video details in batches of 50
          for (let i = 0; i < allVideoIds.length; i += 50) {
            const batchIds = allVideoIds.slice(i, i + 50);

            const videosData = await youtubeRequest<YouTubeVideosResponse>('videos', {
              part: 'snippet,contentDetails,statistics',
              id: batchIds.join(','),
            });
            quotaUsed += 1;

            // Upsert videos
            for (const video of videosData.items) {
              const thumbnailUrl = video.snippet.thumbnails.high?.url ||
                video.snippet.thumbnails.medium?.url ||
                video.snippet.thumbnails.default?.url;

              const { error: videoError } = await supabase
                .from('youtube_videos')
                .upsert({
                  youtube_video_id: video.id,
                  title: video.snippet.title,
                  description: video.snippet.description?.substring(0, 5000),
                  thumbnail_url: thumbnailUrl,
                  channel_title: video.snippet.channelTitle,
                  duration_seconds: parseDuration(video.contentDetails.duration),
                  published_at: video.snippet.publishedAt,
                  view_count: parseInt(video.statistics.viewCount || '0'),
                  like_count: parseInt(video.statistics.likeCount || '0'),
                }, {
                  onConflict: 'youtube_video_id',
                });

              if (videoError) {
                console.error('Failed to upsert video:', videoError);
              }
            }
          }

          // Get current playlist items from database
          const { data: existingItems } = await supabase
            .from('youtube_playlist_items')
            .select('video_id, youtube_videos!inner(youtube_video_id)')
            .eq('playlist_id', dbPlaylistId)
            .is('removed_at', null);

          const existingVideoIds = new Set(
            existingItems?.map((item: { youtube_videos: { youtube_video_id: string } }) =>
              item.youtube_videos.youtube_video_id
            ) || []
          );

          // Determine added and removed videos
          const addedVideoIds = allVideoIds.filter(id => !existingVideoIds.has(id));
          const removedVideoIds = [...existingVideoIds].filter(id => !allVideoIds.includes(id));

          // Mark removed items
          if (removedVideoIds.length > 0) {
            const { data: videosToRemove } = await supabase
              .from('youtube_videos')
              .select('id')
              .in('youtube_video_id', removedVideoIds);

            if (videosToRemove && videosToRemove.length > 0) {
              await supabase
                .from('youtube_playlist_items')
                .update({ removed_at: new Date().toISOString() })
                .eq('playlist_id', dbPlaylistId)
                .in('video_id', videosToRemove.map(v => v.id));

              itemsRemoved = videosToRemove.length;
            }
          }

          // Add new items
          if (addedVideoIds.length > 0) {
            const { data: videosToAdd } = await supabase
              .from('youtube_videos')
              .select('id, youtube_video_id')
              .in('youtube_video_id', addedVideoIds);

            if (videosToAdd && videosToAdd.length > 0) {
              const newItems = videosToAdd.map((video, index) => ({
                playlist_id: dbPlaylistId,
                video_id: video.id,
                position: allVideoIds.indexOf(video.youtube_video_id),
              }));

              await supabase
                .from('youtube_playlist_items')
                .upsert(newItems, {
                  onConflict: 'playlist_id,video_id',
                });

              // Create user video states for new videos
              const newStates = videosToAdd.map(video => ({
                user_id: user.id,
                video_id: video.id,
                is_in_ideation: true,
              }));

              await supabase
                .from('user_video_states')
                .upsert(newStates, {
                  onConflict: 'user_id,video_id',
                  ignoreDuplicates: true,
                });

              itemsAdded = videosToAdd.length;
            }
          }

          // Update playlist sync status
          await supabase
            .from('youtube_playlists')
            .update({
              sync_status: 'completed',
              last_synced_at: new Date().toISOString(),
              item_count: allVideoIds.length,
            })
            .eq('id', dbPlaylistId);

          // Update sync history
          if (syncHistory) {
            await supabase
              .from('youtube_sync_history')
              .update({
                status: 'completed',
                completed_at: new Date().toISOString(),
                items_added: itemsAdded,
                items_removed: itemsRemoved,
                quota_used: quotaUsed,
              })
              .eq('id', syncHistory.id);
          }

          return new Response(
            JSON.stringify({
              success: true,
              itemsAdded,
              itemsRemoved,
              totalItems: allVideoIds.length,
              quotaUsed,
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );

        } catch (syncError) {
          const errorMessage = syncError instanceof Error ? syncError.message : 'Sync failed';
          console.error('Sync error:', errorMessage);

          // Update playlist with error
          await supabase
            .from('youtube_playlists')
            .update({
              sync_status: 'failed',
              sync_error: errorMessage,
            })
            .eq('id', dbPlaylistId);

          // Update sync history
          if (syncHistory) {
            await supabase
              .from('youtube_sync_history')
              .update({
                status: 'failed',
                completed_at: new Date().toISOString(),
                error_message: errorMessage,
                quota_used: quotaUsed,
              })
              .eq('id', syncHistory.id);
          }

          return new Response(
            JSON.stringify({ error: errorMessage }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
      }

      case 'delete-playlist': {
        const body = await req.json();
        const { playlistId: dbPlaylistId } = body;

        if (!dbPlaylistId) {
          return new Response(
            JSON.stringify({ error: 'Playlist ID is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error: deleteError } = await supabase
          .from('youtube_playlists')
          .delete()
          .eq('id', dbPlaylistId)
          .eq('user_id', user.id);

        if (deleteError) {
          console.error('Failed to delete playlist:', deleteError);
          return new Response(
            JSON.stringify({ error: 'Failed to delete playlist' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'list-playlists': {
        const { data: playlists, error: listError } = await supabase
          .from('youtube_playlists')
          .select('*')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (listError) {
          console.error('Failed to list playlists:', listError);
          return new Response(
            JSON.stringify({ error: 'Failed to list playlists' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ playlists }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update-settings': {
        const body = await req.json();
        const { syncInterval, autoSyncEnabled } = body;

        const { error: updateError } = await supabase
          .from('youtube_sync_settings')
          .upsert({
            user_id: user.id,
            sync_interval: syncInterval,
            auto_sync_enabled: autoSyncEnabled,
          }, {
            onConflict: 'user_id',
          });

        if (updateError) {
          console.error('Failed to update settings:', updateError);
          return new Response(
            JSON.stringify({ error: 'Failed to update settings' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get-ideation-videos': {
        // Get all videos in ideation palette for user
        const { data: videos, error: videosError } = await supabase
          .from('user_video_states')
          .select(`
            *,
            video:youtube_videos(*)
          `)
          .eq('user_id', user.id)
          .eq('is_in_ideation', true)
          .order('added_to_ideation_at', { ascending: false });

        if (videosError) {
          console.error('Failed to get ideation videos:', videosError);
          return new Response(
            JSON.stringify({ error: 'Failed to get videos' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ videos }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'update-video-state': {
        const body = await req.json();
        const { videoStateId, updates } = body;

        if (!videoStateId) {
          return new Response(
            JSON.stringify({ error: 'Video state ID is required' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const { error: updateError } = await supabase
          .from('user_video_states')
          .update(updates)
          .eq('id', videoStateId)
          .eq('user_id', user.id);

        if (updateError) {
          console.error('Failed to update video state:', updateError);
          return new Response(
            JSON.stringify({ error: 'Failed to update video state' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({
            error: 'Invalid action',
            validActions: [
              'add-playlist',
              'sync-playlist',
              'delete-playlist',
              'list-playlists',
              'update-settings',
              'get-ideation-videos',
              'update-video-state',
            ]
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('YouTube sync error:', errorMessage);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
