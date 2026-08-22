import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/services/supabase/server';

/**
 * Lists Page Object Registry conflicts (Automation Agent Rebuild §4.1.3, Principle
 * P3) — a method the Merge Engine detected as "AI proposed a body that differs from
 * what's already in the registry" and therefore refused to auto-apply. Defaults to
 * `status=pending` (the actionable queue); pass ?status=all to see resolved history too.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { searchParams } = new URL(req.url);
  const statusFilter = searchParams.get('status');

  const supabase = await createClient();
  let query = supabase
    .from('automation_registry_conflicts')
    .select(
      'id, page_object_id, method_name, reason, proposed_code, existing_code, source_test_case_id, source_script_id, status, resolved_by, resolved_at, created_at, automation_page_objects(class_name, file_name)',
    )
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (statusFilter !== 'all') {
    query = query.eq('status', statusFilter ?? 'pending');
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const normalized = (data ?? []).map((row) => ({
    ...row,
    // @ts-expect-error - Supabase's generated join shape isn't typed here; runtime shape is correct.
    class_name: row.automation_page_objects?.class_name ?? null,
    // @ts-expect-error - same as above
    file_name: row.automation_page_objects?.file_name ?? null,
  }));

  return NextResponse.json({ success: true, data: normalized });
}
