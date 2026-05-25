import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load environment variables for local testing
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  // We log a warning but don't crash immediately, so the code compiles and can be mocked in testing
  console.warn(
    'Warning: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are missing.'
  );
}

// Export the singleton supabase client
export const supabase = createClient(
  supabaseUrl || 'https://mock-supabase-url.supabase.co',
  supabaseServiceRoleKey || 'mock-service-role-key',
  {
    auth: {
      persistSession: false, // Essential for stateless serverless environments
    },
  }
);
