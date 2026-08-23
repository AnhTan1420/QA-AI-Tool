import { NextResponse } from 'next/server';
import { createClient } from '@/services/supabase/server';

/**
 * Audit trail for the Suite Exporter (automation_suite_exports — see schema.sql).
 * No token/secret is ever stored on this table (Principle P6) — only what a
 * completed export actually produced (target, commit_sha, pr_url).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('automation_suite_exports')
    .select('id, target, commit_sha, pr_url, script_versions, exported_at')
    .eq('project_id', projectId)
    .order('exported_at', { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: data ?? [] });
}
