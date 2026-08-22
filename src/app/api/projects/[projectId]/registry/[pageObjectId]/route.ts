import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/services/supabase/server';

/**
 * Full detail for ONE Page Object Registry entry — separate from the list route
 * (GET /api/projects/[projectId]/registry) because `code` (a full .ts file) is
 * comparatively large and the list view only needs summary fields; this keeps the
 * list payload light while still letting the UI drill into any one class on demand.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; pageObjectId: string }> },
) {
  const { projectId, pageObjectId } = await params;
  const supabase = await createClient();

  const { data: entry, error } = await supabase
    .from('automation_page_objects')
    .select('id, class_name, file_name, page_label, page_url_pattern, code, method_signatures, version, updated_at, created_at')
    .eq('project_id', projectId)
    .eq('id', pageObjectId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
  if (!entry) {
    return NextResponse.json({ success: false, error: 'Không tìm thấy Page Object này trong Registry.' }, { status: 404 });
  }

  const { data: refs } = await supabase
    .from('automation_script_page_object_refs')
    .select('script_id, page_object_version_used, automation_scripts(test_case_id)')
    .eq('page_object_id', pageObjectId);

  const usedBy = (refs ?? []).map((r) => ({
    script_id: r.script_id,
    page_object_version_used: r.page_object_version_used,
    // @ts-expect-error - Supabase's generated join shape isn't typed here; runtime shape is correct.
    test_case_id: r.automation_scripts?.test_case_id ?? null,
  }));

  return NextResponse.json({ success: true, data: { ...entry, used_by: usedBy } });
}
