/**
 * fetch-transcript Edge Function
 *
 * Extracts YouTube captions via residential proxy to bypass bot detection.
 * YouTube blocks all datacenter IPs (AWS, Deno Deploy, etc.).
 * WebShare Residential Proxy ($3.50/mo 1GB) provides residential IPs.
 *
 * Env vars (set in Supabase Dashboard > Edge Functions > Secrets):
 *   WEBSHARE_PROXY_HOST, WEBSHARE_PROXY_PORT,
 *   WEBSHARE_PROXY_USERNAME, WEBSHARE_PROXY_PASSWORD
 *
 * Issue: #278 (Client-side YouTube caption extraction)
 */

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

const INNERTUBE_API_URL = 'https://www.youtube.com/youtubei/v1/player?prettyPrint=false';
const INNERTUBE_CLIENT_VERSION = '2.20241126.01.00';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface TranscriptSegment {
  text: string;
  offset: number;
  duration: number;
}

function extractVideoId(urlOrId: string): string | null {
  if (/^[a-zA-Z0-9_-]{11}$/.test(urlOrId)) return urlOrId;
  try {
    const parsed = new URL(urlOrId);
    if (parsed.hostname === 'youtu.be') return parsed.pathname.slice(1) || null;
    if (parsed.hostname.includes('youtube.com')) return parsed.searchParams.get('v');
  } catch {
    // not a URL
  }
  return null;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n/g, ' ')
    .trim();
}

/**
 * Fetch URL via WebShare residential proxy using HTTP CONNECT tunnel.
 * Deno supports proxy via Deno.createHttpClient (Deno >= 1.40).
 */
async function proxyFetch(url: string, options?: RequestInit): Promise<Response> {
  const host = Deno.env.get('WEBSHARE_PROXY_HOST');
  const port = Deno.env.get('WEBSHARE_PROXY_PORT');
  const username = Deno.env.get('WEBSHARE_PROXY_USERNAME');
  const password = Deno.env.get('WEBSHARE_PROXY_PASSWORD');

  if (host && port && username && password) {
    const proxyUrl = `http://${username}:${password}@${host}:${port}`;
    const client = Deno.createHttpClient({ proxy: { url: proxyUrl } });
    return fetch(url, { ...options, client } as RequestInit);
  }

  // Fallback: direct fetch (will likely fail on datacenter IPs)
  console.warn('[fetch-transcript] No proxy configured, using direct fetch');
  return fetch(url, options);
}

async function fetchTranscript(videoId: string, lang: string = 'en'): Promise<TranscriptSegment[]> {
  // Step 1: Get player response via Innertube API (WEB client)
  const playerResponse = await proxyFetch(INNERTUBE_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: 'WEB',
          clientVersion: INNERTUBE_CLIENT_VERSION,
        },
      },
      videoId,
    }),
  });

  if (!playerResponse.ok) {
    throw new Error(`YouTube player API returned ${playerResponse.status}`);
  }

  const playerData = await playerResponse.json();

  const playability = playerData.playabilityStatus;
  if (playability?.status === 'LOGIN_REQUIRED') {
    throw new Error('Video requires login (age-restricted or private)');
  }
  if (playability?.status === 'UNPLAYABLE') {
    throw new Error(`Video is unplayable: ${playability.reason || 'unknown'}`);
  }

  // Step 2: Find caption tracks
  const captionTracks = playerData.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!captionTracks || captionTracks.length === 0) {
    throw new Error('No captions available for this video');
  }

  let track = captionTracks.find((t: { languageCode: string }) => t.languageCode === lang);
  if (!track) {
    const fallbacks = lang === 'en' ? ['ko', 'ja'] : ['en', 'ko'];
    for (const fb of fallbacks) {
      track = captionTracks.find((t: { languageCode: string }) => t.languageCode === fb);
      if (track) break;
    }
  }
  if (!track) {
    track = captionTracks[0];
  }

  // Step 3: Fetch caption XML (via proxy)
  const captionResponse = await proxyFetch(track.baseUrl);
  if (!captionResponse.ok) {
    throw new Error(`Failed to fetch captions: ${captionResponse.status}`);
  }

  const captionXml = await captionResponse.text();

  // Step 4: Parse XML
  const segments: TranscriptSegment[] = [];
  const regex = /<text start="([^"]*)" dur="([^"]*)">([^<]*)<\/text>/g;
  let match;
  while ((match = regex.exec(captionXml)) !== null) {
    const text = decodeHtmlEntities(match[3]!);
    if (text) {
      segments.push({
        text,
        offset: Math.round(parseFloat(match[1]!) * 1000),
        duration: Math.round(parseFloat(match[2]!) * 1000),
      });
    }
  }

  return segments;
}

console.log('fetch-transcript Edge Function loaded');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: getCorsHeaders(req) });
  }

  const corsHeaders = getCorsHeaders(req);
  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

  try {
    const url = new URL(req.url);
    const videoParam = url.searchParams.get('video_id') || url.searchParams.get('v');
    const lang = url.searchParams.get('lang') || 'en';

    let videoInput = videoParam;
    if (!videoInput && req.method === 'POST') {
      const body = await req.json();
      videoInput = body.video_id || body.url;
    }

    if (!videoInput) {
      return new Response(
        JSON.stringify({ error: 'video_id or url parameter required' }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const videoId = extractVideoId(videoInput);
    if (!videoId) {
      return new Response(
        JSON.stringify({ error: 'Invalid video ID or URL' }),
        { status: 400, headers: jsonHeaders }
      );
    }

    const segments = await fetchTranscript(videoId, lang);
    const fullText = segments.map((s) => s.text).join(' ');

    return new Response(
      JSON.stringify({
        video_id: videoId,
        language: lang,
        segments: segments.length,
        full_text: fullText,
      }),
      { status: 200, headers: jsonHeaders }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[fetch-transcript] Error:', message);

    const status = message.includes('No captions') ? 404 : 422;
    return new Response(
      JSON.stringify({ error: message }),
      { status, headers: jsonHeaders }
    );
  }
});
