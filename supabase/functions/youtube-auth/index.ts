import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// YouTube OAuth 2.0 endpoints
const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

// Required scopes for YouTube playlist access
const SCOPES = [
  'https://www.googleapis.com/auth/youtube.readonly',
];

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

console.log("youtube-auth Edge Function loaded");

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const clientId = Deno.env.get('YOUTUBE_CLIENT_ID');
  const clientSecret = Deno.env.get('YOUTUBE_CLIENT_SECRET');
  const redirectUri = Deno.env.get('YOUTUBE_REDIRECT_URI');

  if (!clientId || !clientSecret || !redirectUri) {
    console.error('Missing YouTube OAuth configuration');
    return new Response(
      JSON.stringify({ error: 'YouTube OAuth is not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {
    switch (action) {
      case 'auth-url': {
        // Generate OAuth authorization URL
        const state = crypto.randomUUID();

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

        const authUrl = new URL(GOOGLE_AUTH_URL);
        authUrl.searchParams.set('client_id', clientId);
        authUrl.searchParams.set('redirect_uri', redirectUri);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('scope', SCOPES.join(' '));
        authUrl.searchParams.set('access_type', 'offline');
        authUrl.searchParams.set('prompt', 'consent');
        authUrl.searchParams.set('state', `${state}:${user.id}`);

        return new Response(
          JSON.stringify({ authUrl: authUrl.toString() }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'callback': {
        // Handle OAuth callback
        const code = url.searchParams.get('code');
        const state = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          console.error('OAuth error:', error);
          return new Response(
            JSON.stringify({ error: `OAuth error: ${error}` }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        if (!code || !state) {
          return new Response(
            JSON.stringify({ error: 'Missing code or state parameter' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Extract user ID from state
        const [, userId] = state.split(':');
        if (!userId) {
          return new Response(
            JSON.stringify({ error: 'Invalid state parameter' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Exchange code for tokens
        const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
          }),
        });

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          console.error('Token exchange failed:', errorText);
          return new Response(
            JSON.stringify({ error: 'Failed to exchange code for tokens' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const tokens: TokenResponse = await tokenResponse.json();
        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

        // Save tokens to database
        const { error: upsertError } = await supabase
          .from('youtube_sync_settings')
          .upsert({
            user_id: userId,
            youtube_access_token: tokens.access_token,
            youtube_refresh_token: tokens.refresh_token || null,
            youtube_token_expires_at: expiresAt,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'user_id',
          });

        if (upsertError) {
          console.error('Failed to save tokens:', upsertError);
          return new Response(
            JSON.stringify({ error: 'Failed to save authentication' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Return HTML that closes the popup and notifies parent
        const html = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>YouTube 연결 완료</title>
            </head>
            <body>
              <script>
                if (window.opener) {
                  window.opener.postMessage({ type: 'youtube-auth-success' }, '*');
                  window.close();
                } else {
                  document.body.innerHTML = '<h1>YouTube 계정이 연결되었습니다. 이 창을 닫아주세요.</h1>';
                }
              </script>
              <h1>YouTube 계정 연결 완료</h1>
              <p>이 창을 닫아주세요.</p>
            </body>
          </html>
        `;

        return new Response(html, {
          headers: { ...corsHeaders, 'Content-Type': 'text/html' },
        });
      }

      case 'refresh': {
        // Refresh access token
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

        // Get current refresh token
        const { data: settings, error: settingsError } = await supabase
          .from('youtube_sync_settings')
          .select('youtube_refresh_token')
          .eq('user_id', user.id)
          .single();

        if (settingsError || !settings?.youtube_refresh_token) {
          return new Response(
            JSON.stringify({ error: 'No refresh token available' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Refresh the token
        const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            refresh_token: settings.youtube_refresh_token,
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
          }),
        });

        if (!tokenResponse.ok) {
          const errorText = await tokenResponse.text();
          console.error('Token refresh failed:', errorText);
          return new Response(
            JSON.stringify({ error: 'Failed to refresh token' }),
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const tokens: TokenResponse = await tokenResponse.json();
        const expiresAt = new Date(Date.now() + tokens.expires_in * 1000).toISOString();

        // Update tokens in database
        const { error: updateError } = await supabase
          .from('youtube_sync_settings')
          .update({
            youtube_access_token: tokens.access_token,
            youtube_token_expires_at: expiresAt,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id);

        if (updateError) {
          console.error('Failed to update tokens:', updateError);
          return new Response(
            JSON.stringify({ error: 'Failed to save refreshed token' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true, expiresAt }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'disconnect': {
        // Disconnect YouTube account
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

        // Clear tokens from database
        const { error: updateError } = await supabase
          .from('youtube_sync_settings')
          .update({
            youtube_access_token: null,
            youtube_refresh_token: null,
            youtube_token_expires_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', user.id);

        if (updateError) {
          console.error('Failed to disconnect:', updateError);
          return new Response(
            JSON.stringify({ error: 'Failed to disconnect YouTube account' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'status': {
        // Check connection status
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

        const { data: settings } = await supabase
          .from('youtube_sync_settings')
          .select('youtube_access_token, youtube_token_expires_at, sync_interval, auto_sync_enabled')
          .eq('user_id', user.id)
          .single();

        const isConnected = !!settings?.youtube_access_token;
        const isExpired = settings?.youtube_token_expires_at
          ? new Date(settings.youtube_token_expires_at) < new Date()
          : true;

        return new Response(
          JSON.stringify({
            isConnected,
            isExpired: isConnected ? isExpired : null,
            expiresAt: settings?.youtube_token_expires_at || null,
            syncInterval: settings?.sync_interval || 'manual',
            autoSyncEnabled: settings?.auto_sync_enabled || false,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action. Use: auth-url, callback, refresh, disconnect, status' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('YouTube auth error:', errorMessage);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
