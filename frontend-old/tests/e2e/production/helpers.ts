import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL!;
const SUPABASE_KEY = process.env.VITE_SUPABASE_PUBLISHABLE_KEY!;
const API_BASE = process.env.E2E_API_BASE || 'https://insighta.one';

export async function getAuthToken(): Promise<string> {
  const email = process.env.E2E_TEST_EMAIL!;
  const password = process.env.E2E_TEST_PASSWORD!;

  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    throw new Error(`Auth failed: ${error?.message || 'no session'}`);
  }

  return data.session.access_token;
}

export async function apiRequest(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
}

export async function cleanup(token: string, playlistId: string): Promise<void> {
  try {
    await apiRequest(`/api/v1/playlists/${playlistId}`, token, { method: 'DELETE' });
  } catch {
    // Best-effort cleanup
  }
}
