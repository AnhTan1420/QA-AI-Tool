import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { browserProfileRequestSchema } from '@/lib/validators/automation';
import { encryptSecret } from '@/lib/automation/encryption';
import { captureStorageStateFromLoginScript } from '@/lib/automation/executor';

export const maxDuration = 120;
export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('project_id');
  if (!projectId) {
    return NextResponse.json({ success: false, error: 'project_id required' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('browser_profiles')
    .select('id, project_id, name, description, created_by, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
}

export async function POST(req: Request) {
  try {
    const input = browserProfileRequestSchema.parse(await req.json());
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    let storageStateJson: string | undefined;
    if (input.storage_state_json) {
      storageStateJson = input.storage_state_json;
    } else if (input.login_script) {
      storageStateJson = await captureStorageStateFromLoginScript(input.login_script, 'chromium');
    }

    const { data, error } = await supabase
      .from('browser_profiles')
      .insert({
        project_id: input.project_id,
        name: input.name,
        description: input.description ?? null,
        storage_state: storageStateJson ? encryptSecret(storageStateJson) : null,
        created_by: user.id,
      })
      .select('id, project_id, name, description, created_by, created_at')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid input' }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Profile creation failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
