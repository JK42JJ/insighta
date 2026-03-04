import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface UrlMetadata {
  title: string;
  description: string;
  image: string;
  siteName: string;
  author: string;
  url: string;
}

// Validate URL to prevent SSRF attacks
function isValidUrl(urlString: string): { valid: boolean; error?: string } {
  try {
    const url = new URL(urlString);
    
    // Only allow http/https protocols
    if (!['http:', 'https:'].includes(url.protocol)) {
      return { valid: false, error: 'Only HTTP and HTTPS protocols are allowed' };
    }
    
    const hostname = url.hostname.toLowerCase();
    
    // Block localhost and loopback addresses
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return { valid: false, error: 'Localhost addresses are not allowed' };
    }
    
    // Block private IP ranges
    const ipMatch = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipMatch) {
      const [, a, b, c] = ipMatch.map(Number);
      
      // 10.0.0.0/8
      if (a === 10) {
        return { valid: false, error: 'Private IP addresses are not allowed' };
      }
      // 172.16.0.0/12
      if (a === 172 && b >= 16 && b <= 31) {
        return { valid: false, error: 'Private IP addresses are not allowed' };
      }
      // 192.168.0.0/16
      if (a === 192 && b === 168) {
        return { valid: false, error: 'Private IP addresses are not allowed' };
      }
      // 169.254.0.0/16 (link-local, cloud metadata)
      if (a === 169 && b === 254) {
        return { valid: false, error: 'Link-local addresses are not allowed' };
      }
      // 0.0.0.0
      if (a === 0) {
        return { valid: false, error: 'Invalid IP address' };
      }
    }
    
    // Block cloud metadata endpoints
    if (hostname === 'metadata.google.internal' || 
        hostname.endsWith('.internal') ||
        hostname === 'metadata') {
      return { valid: false, error: 'Cloud metadata endpoints are not allowed' };
    }
    
    return { valid: true };
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { url } = await req.json();
    
    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate URL to prevent SSRF
    const validation = isValidUrl(url);
    if (!validation.valid) {
      console.log('URL validation failed:', url, validation.error);
      return new Response(
        JSON.stringify({ error: validation.error || 'Invalid URL' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Fetching metadata for URL:', url);

    // Fetch the page HTML with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MetadataBot/1.0)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        console.error('Failed to fetch URL:', response.status, response.statusText);
        return new Response(
          JSON.stringify({ 
            error: 'Failed to fetch URL',
            metadata: getDefaultMetadata(url)
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Limit response size to prevent memory exhaustion (5MB max)
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > 5 * 1024 * 1024) {
        return new Response(
          JSON.stringify({ 
            error: 'Response too large',
            metadata: getDefaultMetadata(url)
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const html = await response.text();
      
      // Parse metadata from HTML
      const metadata = parseMetadata(html, url);
      
      console.log('Extracted metadata:', metadata);

      return new Response(
        JSON.stringify({ metadata }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        return new Response(
          JSON.stringify({ 
            error: 'Request timeout',
            metadata: getDefaultMetadata(url)
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw fetchError;
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching metadata:', errorMessage);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process request',
        metadata: null
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

function getDefaultMetadata(url: string): UrlMetadata {
  const hostname = new URL(url).hostname;
  return {
    title: '',
    description: '',
    image: '',
    siteName: hostname,
    author: '',
    url: url,
  };
}

function parseMetadata(html: string, url: string): UrlMetadata {
  const metadata: UrlMetadata = getDefaultMetadata(url);
  
  // Helper function to extract meta content
  const getMetaContent = (property: string): string => {
    // Try og: prefix first
    let match = html.match(new RegExp(`<meta[^>]*property=["']og:${property}["'][^>]*content=["']([^"']+)["']`, 'i'));
    if (match) return decodeHtmlEntities(match[1]);
    
    // Try content before property
    match = html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:${property}["']`, 'i'));
    if (match) return decodeHtmlEntities(match[1]);
    
    // Try name attribute
    match = html.match(new RegExp(`<meta[^>]*name=["']${property}["'][^>]*content=["']([^"']+)["']`, 'i'));
    if (match) return decodeHtmlEntities(match[1]);
    
    // Try content before name
    match = html.match(new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*name=["']${property}["']`, 'i'));
    if (match) return decodeHtmlEntities(match[1]);
    
    return '';
  };

  // Extract title
  metadata.title = getMetaContent('title') || '';
  if (!metadata.title) {
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
    if (titleMatch) metadata.title = decodeHtmlEntities(titleMatch[1].trim());
  }

  // Extract description
  metadata.description = getMetaContent('description') || '';

  // Extract image
  metadata.image = getMetaContent('image') || '';
  
  // Handle relative URLs for images
  if (metadata.image && !metadata.image.startsWith('http')) {
    const baseUrl = new URL(url);
    metadata.image = metadata.image.startsWith('/') 
      ? `${baseUrl.protocol}//${baseUrl.host}${metadata.image}`
      : `${baseUrl.protocol}//${baseUrl.host}/${metadata.image}`;
  }

  // Extract site name
  metadata.siteName = getMetaContent('site_name') || '';
  if (!metadata.siteName) {
    metadata.siteName = new URL(url).hostname.replace('www.', '');
  }

  // Extract author
  metadata.author = getMetaContent('author') || 
                    getMetaContent('article:author') || 
                    getMetaContent('twitter:creator') || '';

  // LinkedIn specific parsing
  if (url.includes('linkedin.com')) {
    // Try to get LinkedIn specific metadata
    const linkedinAuthor = html.match(/data-tracking-control-name="public_post_feed-actor-name"[^>]*>([^<]+)</i);
    if (linkedinAuthor) {
      metadata.author = decodeHtmlEntities(linkedinAuthor[1].trim());
    }
    
    // Try actor name from different pattern
    const actorMatch = html.match(/<span[^>]*class="[^"]*actor[^"]*"[^>]*>([^<]+)</i);
    if (actorMatch && !metadata.author) {
      metadata.author = decodeHtmlEntities(actorMatch[1].trim());
    }
  }

  return metadata;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&nbsp;/g, ' ');
}
