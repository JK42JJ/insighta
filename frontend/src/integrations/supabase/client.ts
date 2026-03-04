import { createClient } from '@supabase/supabase-js';

// Supabase client configuration
// Uses environment variables for both local development and production
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:8000';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

if (!supabaseUrl || supabaseUrl === 'http://localhost:8000') {
  console.warn(
    'VITE_SUPABASE_URL is not set or using default. ' +
    'Set it in .env for production: VITE_SUPABASE_URL=https://your-project.supabase.co'
  );
}

if (!supabaseAnonKey) {
  console.warn(
    'VITE_SUPABASE_PUBLISHABLE_KEY is not set. ' +
    'Authentication features will not work.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
