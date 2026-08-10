import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: testCaseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  // Only return the single active script (no version history)
  const { data, error } = await supabase
    .from('automation_scripts')
    .select('id, version, code, page_objects, imports_used, selectors_used, warnings, created_at, profiles(full_name)')
    .eq('test_case_id', testCaseId)
    .is('deleted_at', null)
    .order('version', { ascending: false })
    .limit(1);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, data: data ?? [] });
}

/**
 * POST /api/test-cases/[id]/automation/scripts
 * Upsert: update existing script OR insert new one. No versioning.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: testCaseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { code, page_objects, imports_used, selectors_used, warnings, script_id } = body;

  if (!code || typeof code !== 'string') {
    return NextResponse.json({ success: false, error: 'Missing code' }, { status: 400 });
  }

  // If script_id provided, update existing; otherwise insert new
  if (script_id) {
    const { data: updated, error: updateError } = await supabase
      .from('automation_scripts')
      .update({
        code,
        page_objects: page_objects ?? [],
        imports_used: imports_used ?? [],
        selectors_used: selectors_used ?? [],
        warnings: warnings ?? [],
        generated_by: user.id,
      })
      .eq('id', script_id)
      .eq('test_case_id', testCaseId)
      .select('id, version')
      .single();

    if (updateError || !updated) {
      return NextResponse.json({ success: false, error: updateError?.message ?? 'Update failed' }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: { id: updated.id, version: updated.version } });
  }

  // Insert new (first time)
  const { data: saved, error: saveError } = await supabase
    .from('automation_scripts')
    .insert({
      test_case_id: testCaseId,
      version: 1,
      code,
      page_objects: page_objects ?? [],
      imports_used: imports_used ?? [],
      selectors_used: selectors_used ?? [],
      warnings: warnings ?? [],
      generated_by: user.id,
    })
    .select('id, version')
    .single();

  if (saveError || !saved) {
    return NextResponse.json({ success: false, error: saveError?.message ?? 'Save failed' }, { status: 500 });
  }

  await supabase
    .from('test_cases')
    .update({ automation_status: 'generated' })
    .eq('id', testCaseId)
    .eq('automation_status', 'not_generated');

  return NextResponse.json({ success: true, data: { id: saved.id, version: saved.version } });
}
