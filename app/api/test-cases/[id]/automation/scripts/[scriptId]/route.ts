import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

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