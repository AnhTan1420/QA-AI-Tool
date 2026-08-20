import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { createClient } from '@/services/supabase/server';
import { projectEnvironmentSchema } from '@/models/validators/playwright';

/**
 * Saved, NON-secret automation target config per project (browser + target_url +
 * which auth mode to prompt for) — see schema.sql's "Batch Automation" section
 * header comment for why this never stores cookie_token/username/password.
 * Lets a QA configure "Staging" / "Production" once and reuse it across every
 * single-test-case automation run AND every batch run, instead of retyping the
 * target URL each time.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('project_environments')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const rawBody = await req.json();
    const payload = projectEnvironmentSchema.parse(rawBody);

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Bạn cần đăng nhập.' }, { status: 401 });
    }

    // Member check — same pattern as app/api/test-cases POST: fail fast with a
    // clear message rather than relying solely on RLS to reject the insert.
    const { data: membership } = await supabase
      .from('project_members')
      .select('user_id')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle();
    if (!membership) {
      return NextResponse.json({ success: false, error: 'Bạn không phải thành viên của project này.' }, { status: 403 });
    }

    const { data, error } = await supabase
      .from('project_environments')
      .insert({
        project_id: projectId,
        name: payload.name,
        browser: payload.browser,
        target_url: payload.target_url,
        auth_mode: payload.auth_mode,
        created_by: user.id,
      })
      .select('*')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      const errorMessage =
        'Dữ liệu đầu vào không hợp lệ: ' + error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      return NextResponse.json({ success: false, error: errorMessage, details: error.issues }, { status: 400 });
    }
    const failureMessage = error instanceof Error ? error.message : 'Không thể tạo environment';
    return NextResponse.json({ success: false, error: failureMessage }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ success: false, error: 'Thiếu id' }, { status: 400 });
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('project_environments')
    .delete()
    .eq('id', id)
    .eq('project_id', projectId);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
