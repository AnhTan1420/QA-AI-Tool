import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Client dung SERVICE ROLE KEY - bo qua moi RLS.
 * CHI dung trong route handler tin cay tren server cho tac vu he thong khong the
 * lam qua RLS thong thuong (vi du: tra cuu user theo email de moi vao project).
 * KHONG BAO GIO import file nay vao code co the chay o client.
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Thieu NEXT_PUBLIC_SUPABASE_URL hoac SUPABASE_SERVICE_ROLE_KEY.');
  }

  return createSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
