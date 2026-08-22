import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/services/supabase/server';

/**
 * Project Page Object Registry (Automation Agent Rebuild §4.1/§7) — read-only view
 * of automation_page_objects for a project. Returns a `used_by_count` per entry
 * (via automation_script_page_object_refs) so the UI can show "how many test cases
 * depend on this class" — useful context before anyone considers editing/resolving
 * a conflict on it. RLS (project_members) is the actual access control here; this
 * route does no additional membership check beyond what the query naturally returns.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data: entries, error } = await supabase
    .from('automation_page_objects')
    .select('id, class_name, file_name, page_label, page_url_pattern, method_signatures, version, updated_at, created_at')
    .eq('project_id', projectId)
    .order('class_name', { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const entryIds = (entries ?? []).map((e) => e.id);
  const usedByCount = new Map<string, number>();
  if (entryIds.length > 0) {
    const { data: refs } = await supabase
      .from('automation_script_page_object_refs')
      .select('page_object_id')
      .in('page_object_id', entryIds);
    for (const ref of refs ?? []) {
      usedByCount.set(ref.page_object_id, (usedByCount.get(ref.page_object_id) ?? 0) + 1);
    }
  }

  const { data: pendingConflicts } = await supabase
    .from('automation_registry_conflicts')
    .select('page_object_id')
    .eq('project_id', projectId)
    .eq('status', 'pending');
  const pendingConflictCount = new Map<string, number>();
  for (const c of pendingConflicts ?? []) {
    pendingConflictCount.set(c.page_object_id, (pendingConflictCount.get(c.page_object_id) ?? 0) + 1);
  }

  const data = (entries ?? []).map((e) => ({
    ...e,
    used_by_test_case_count: usedByCount.get(e.id) ?? 0,
    pending_conflict_count: pendingConflictCount.get(e.id) ?? 0,
  }));

  return NextResponse.json({ success: true, data });
}
