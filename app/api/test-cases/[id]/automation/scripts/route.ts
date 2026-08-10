import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: testCaseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('automation_scripts')
    .select('id, version, code, page_objects, imports_used, selectors_used, warnings, created_at, profiles(full_name)')
    .eq('test_case_id', testCaseId)
    .order('version', { ascending: false })
    .limit(10);

  if (error) return NextResponse.json({ success: false, error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, data: data ?? [] });
}

/**
 * POST /api/test-cases/[id]/automation/scripts
 * Saves a manually-edited Playwright script as a new version.
 * Called from useAutomation.saveEditedScript().
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: testCaseId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { code, page_objects, imports_used, selectors_used, warnings } = body;

  if (!code || typeof code !== 'string') {
    return NextResponse.json({ success: false, error: 'Missing code' }, { status: 400 });
  }

  // Get next version number
  const { data: existing } = await supabase
    .from('automation_scripts')
    .select('version')
    .eq('test_case_id', testCaseId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextVersion = (existing?.version ?? 0) + 1;

  const { data: saved, error: saveError } = await supabase
    .from('automation_scripts')
    .insert({
      test_case_id: testCaseId,
      version: nextVersion,
      code,
      page_objects: page_objects ?? [],
      imports_used: imports_used ?? [],
      selectors_used: selectors_used ?? [],
      warnings: warnings ?? [],
      generated_by: user.id,
    })
    .select('id')
    .single();

  if (saveError || !saved) {
    return NextResponse.json({ success: false, error: saveError?.message ?? 'Save failed' }, { status: 500 });
  }

  // Update automation status badge if still 'not_generated'
  await supabase
    .from('test_cases')
    .update({ automation_status: 'generated' })
    .eq('id', testCaseId)
    .eq('automation_status', 'not_generated');

  return NextResponse.json({ success: true, data: { id: saved.id, version: nextVersion } });
}
