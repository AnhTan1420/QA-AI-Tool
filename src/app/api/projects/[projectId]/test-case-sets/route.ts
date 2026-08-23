import { NextResponse } from 'next/server';
import { createClient } from '@/services/supabase/server';

/**
 * Lists a project's test_case_sets with their requirement title (if any) and a
 * quick test-case count — primarily for the Suite Export scope picker (Automation
 * Agent Rebuild §4.4), so a user can pick "just this feature/set" instead of the
 * whole project without needing to open each one first.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('test_case_sets')
    .select('id, created_at, requirements(title), test_cases(count)')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const sets = (data ?? []).map((row) => ({
    id: row.id,
    // @ts-expect-error - Supabase's generated nested-join shape isn't typed here; runtime shape is correct.
    title: row.requirements?.title ?? 'Chưa đặt tên',
    test_case_count: row.test_cases?.[0]?.count ?? 0,
    created_at: row.created_at,
  }));

  return NextResponse.json({ success: true, data: sets });
}
