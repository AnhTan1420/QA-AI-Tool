import { createClient } from '@/lib/supabase/server';
import { decryptSecret, decryptCredentials, encryptSecret, encryptCredentials } from './encryption';

export type ScriptRow = {
  id: string;
  test_case_id: string;
  test_case_set_id: string;
  browser_profile_id: string | null;
  environment: 'chromium' | 'firefox' | 'webkit';
  target_url: string;
  cookie_token: string | null;
  credentials: { username: string; password: string } | null;
  generated_code: string;
  status: string;
  baseline_screenshot_path: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export async function fetchScriptById(scriptId: string, includeSecrets = false) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('automation_scripts')
    .select('*, test_case_sets!inner(project_id)')
    .eq('id', scriptId)
    .maybeSingle();

  if (error || !data) return { error: error?.message ?? 'Script not found', data: null };

  const { test_case_sets, ...script } = data as ScriptRow & { test_case_sets: { project_id: string } };
  const projectId = test_case_sets.project_id;

  if (includeSecrets) {
    const decrypted = { ...script } as ScriptRow;
    if (decrypted.cookie_token) {
      try {
        decrypted.cookie_token = decryptSecret(decrypted.cookie_token);
      } catch {
        /* leave encrypted if key missing */
      }
    }
    if (decrypted.credentials?.password) {
      try {
        decrypted.credentials = decryptCredentials(decrypted.credentials);
      } catch {
        /* leave as-is */
      }
    }
    return { data: { script: decrypted, projectId }, error: null };
  }

  const safe = {
    ...script,
    cookie_token: script.cookie_token ? '***' : null,
    credentials: script.credentials
      ? { username: script.credentials.username, password: '***' }
      : null,
  };

  return { data: { script: safe, projectId }, error: null };
}

export function encryptScriptSecrets(input: {
  cookie_token?: string;
  credentials?: { username: string; password: string };
}) {
  return {
    cookie_token: input.cookie_token ? encryptSecret(input.cookie_token) : null,
    credentials: input.credentials ? encryptCredentials(input.credentials) : null,
  };
}

export async function fetchBrowserProfileStorage(profileId: string): Promise<string | undefined> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('browser_profiles')
    .select('storage_state')
    .eq('id', profileId)
    .maybeSingle();

  if (!data?.storage_state) return undefined;
  try {
    return decryptSecret(data.storage_state);
  } catch {
    return undefined;
  }
}

export async function fetchTestCaseWithContext(testCaseId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('test_cases')
    .select('*, test_case_sets!inner(id, project_id, requirement_id, requirements(description))')
    .eq('id', testCaseId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}
