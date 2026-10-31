
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error(
    'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY GitHub Secrets.'
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

async function keepSupabaseAlive() {
  console.log('Starting Supabase keep-alive check...');

  try {
    // Query an existing table to generate database activity.
    // Replace 'your_table' with a real table in your project.
    const { error } = await supabase
      .from('your_table')
      .select('*')
      .limit(1);

    if (error) {
      throw error;
    }

    console.log('Supabase keep-alive successful.');
  } catch (error) {
    console.error('Supabase keep-alive failed:', error.message);
    process.exit(1);
  }
}

keepSupabaseAlive();
