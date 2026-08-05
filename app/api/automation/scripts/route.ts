import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  saveAutomationScriptSchema,
  patchAutomationScriptSchema,
} from '@/lib/validators/automation';
import { encryptScriptSecrets } from '@/lib/automation/db-helpers';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const testCaseId = req.nextUrl.searchParams.get('test_case_id');
  const includeSecrets = req.nextUrl.searchParams.get('include_secrets') === 'true';

  if (!testCaseId) {
    return NextResponse.json({ success: false, error: 'test_case_id required' }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('automation_scripts')
    .select('*')
    .eq('test_case_id', testCaseId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const scripts = (data ?? []).map((s) => ({
    ...s,
    cookie_token: includeSecrets ? s.cookie_token : s.cookie_token ? '***' : null,
    credentials: s.credentials
      ? { username: s.credentials.username, password: includeSecrets ? s.credentials.password : '***' }
      : null,
  }));

  return NextResponse.json({ success: true, data: scripts });
}

export async function POST(req: Request) {
  try {
    const input = saveAutomationScriptSchema.parse(await req.json());
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const secrets = encryptScriptSecrets({
      cookie_token: input.cookie_token,
      credentials: input.credentials,
    });

    const { data, error } = await supabase
      .from('automation_scripts')
      .insert({
        test_case_id: input.test_case_id,
        test_case_set_id: input.test_case_set_id,
        browser_profile_id: input.browser_profile_id ?? null,
        environment: input.environment,
        target_url: input.target_url,
        cookie_token: secrets.cookie_token,
        credentials: secrets.credentials,
        generated_code: input.generated_code,
        status: input.status,
        created_by: user.id,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: { ...data, cookie_token: '***', credentials: data.credentials ? { username: data.credentials.username, password: '***' } : null },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid input', details: error.issues }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Save failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
