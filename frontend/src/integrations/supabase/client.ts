import { createClient } from '@supabase/supabase-js';

// Supabase client configuration
// Uses environment variables for both local development and production
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'http://localhost:8000';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || '';

if (!supabaseUrl) {
  console.warn('VITE_SUPABASE_URL is not set. Using default localhost:8000');
}

if (!supabaseAnonKey) {
  console.warn('VITE_SUPABASE_PUBLISHABLE_KEY is not set. Some features may not work.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
