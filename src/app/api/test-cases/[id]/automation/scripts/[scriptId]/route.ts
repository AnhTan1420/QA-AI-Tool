import { NextResponse } from 'next/server';
import { createClient } from '@/services/supabase/server';

/**
 * PATCH /api/test-cases/[id]/automation/scripts/[scriptId]
 * Body: { action: 'approve' }
 *
 * "Review Gate" state machine - moves a script from 'pending_review' to
 * 'approved' WITHOUT editing its code (the "Approve & Run" branch; the other
 * branch, "Edit / Tweak", self-approves on save - see the POST handler in
 * ../route.ts). Called by useAutomation.approveScript(), which
 * useAutomation.approveAndRun() calls right before runTest().
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; scriptId: string }> },
) {
  const { id: testCaseId, scriptId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  if (body?.action !== 'approve') {
    return NextResponse.json({ success: false, error: "Unsupported action (expected 'approve')" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const { data: updated, error: updateError } = await supabase
    .from('automation_scripts')
    .update({ status: 'approved', approved_by: user.id, approved_at: now })
    .eq('id', scriptId)
    .eq('test_case_id', testCaseId)
    .is('deleted_at', null)
    .select('id, status, approved_at')
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ success: false, error: updateError.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json({ success: false, error: 'Script not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true, data: updated });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; scriptId: string }> }
) {
  const { id: testCaseId, scriptId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { data: script, error: findError } = await supabase
    .from('automation_scripts')
    .select('id, test_case_id')
    .eq('id', scriptId)
    .eq('test_case_id', testCaseId)
    .is('deleted_at', null)
    .maybeSingle();

  if (findError || !script) {
    return NextResponse.json({ success: false, error: 'Script not found' }, { status: 404 });
  }

  const { error } = await supabase
    .from('automation_scripts')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', scriptId);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}