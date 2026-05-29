import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables for local testing
dotenv.config();

function isValidUrl(url: string | undefined): boolean {
  if (!url) return false;
  if (url === 'your_supabase_url' || url.includes('mock-supabase-url')) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

const rawSupabaseUrl = process.env.SUPABASE_URL;
const rawSupabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const isDbConfigured = isValidUrl(rawSupabaseUrl) && 
                       !!rawSupabaseKey && 
                       rawSupabaseKey !== 'your_service_role_key' &&
                       rawSupabaseKey !== 'mock-service-role-key';

const supabaseUrl = isDbConfigured ? rawSupabaseUrl! : 'https://mock-supabase-url.supabase.co';
const supabaseKey = isDbConfigured ? rawSupabaseKey! : 'mock-service-role-key';

// Initialize the real supabase client with valid URL to prevent initialization crash
const realSupabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false, // Essential for stateless serverless environments
  },
});

// Export a proxied supabase client that throws a clear error if the database is not configured
export const supabase = new Proxy(realSupabase, {
  get(target, prop, receiver) {
    if (!isDbConfigured) {
      // In local tests, fetch is intercepted, so we allow it to proceed if running under test
      const isTestEnv = process.env.NODE_ENV === 'test' || process.env.BASE_URL === 'http://localhost:3000';
      if (!isTestEnv) {
        throw new Error(
          'Supabase is not configured. Please set the SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables in your Netlify site settings.'
        );
      }
    }
    return Reflect.get(target, prop, receiver);
  },
});
