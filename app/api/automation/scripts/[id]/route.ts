import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { patchAutomationScriptSchema } from '@/lib/validators/automation';
import { deleteAutomationStoragePrefix } from '@/lib/automation/storage';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const input = patchAutomationScriptSchema.parse(await req.json());
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { data: current } = await supabase
      .from('automation_scripts')
      .select('generated_code')
      .eq('id', id)
      .maybeSingle();

    if (!current) {
      return NextResponse.json({ success: false, error: 'Script not found' }, { status: 404 });
    }

    if (input.generated_code && input.generated_code !== current.generated_code) {
      await supabase.from('automation_script_versions').insert({
        script_id: id,
        code: current.generated_code,
        change_summary: input.change_summary ?? 'Manual edit',
        changed_by: user.id,
      });
    }

    const { generated_code, change_summary, ...updates } = input;
    const { data, error } = await supabase
      .from('automation_scripts')
      .update({
        ...updates,
        ...(generated_code ? { generated_code } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid input' }, { status: 400 });
    }
    return NextResponse.json({ success: false, error: 'Update failed' }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: script } = await supabase
    .from('automation_scripts')
    .select('*, test_case_sets!inner(project_id)')
    .eq('id', id)
    .maybeSingle();

  if (!script) {
    return NextResponse.json({ success: false, error: 'Script not found' }, { status: 404 });
  }

  const projectId = (script as { test_case_sets: { project_id: string } }).test_case_sets.project_id;

  const { error } = await supabase.from('automation_scripts').delete().eq('id', id);
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  await deleteAutomationStoragePrefix(projectId, id).catch(() => {});

  return NextResponse.json({ success: true, data: { id } });
}
