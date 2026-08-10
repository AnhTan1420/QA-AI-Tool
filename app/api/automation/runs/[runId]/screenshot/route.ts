import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resignScreenshotUrl } from '@/lib/automation/screenshot-storage';

/**
 * GET /api/automation/runs/[runId]/screenshot
 *
 * Section 6 enhancement (AUDIT_REPORT.md item G): both Supabase signed URLs and
 * R2 signed URLs expire after 7 days. Rather than have the UI store a URL that
 * silently rots, this route always re-derives a FRESH signed URL from the stored
 * `screenshot_url` PATH (never a URL) on automation_runs, then redirects to it.
 * Safe to bookmark/share internally — RLS on automation_runs (via the join in
 * schema.sql) still governs who can read the row in the first place.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const supabase = await createClient();

  const { data: run, error } = await supabase
    .from('automation_runs')
    .select('screenshot_url')
    .eq('id', runId)
    .maybeSingle();

  if (error || !run || !run.screenshot_url) {
    return NextResponse.json({ success: false, error: 'Screenshot not found' }, { status: 404 });
  }

  const freshUrl = await resignScreenshotUrl(supabase, run.screenshot_url);
  if (!freshUrl) {
    return NextResponse.json({ success: false, error: 'Unable to generate screenshot URL' }, { status: 500 });
  }

  return NextResponse.redirect(freshUrl);
}
