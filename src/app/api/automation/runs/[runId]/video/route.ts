import { NextResponse } from 'next/server';
import { createClient } from '@/services/supabase/server';
import { resignRunArtifactUrl } from '@/services/automation/run-artifact-storage';

/**
 * GET /api/automation/runs/[runId]/video
 *
 * Self-hosted "Full run" only (see playwright-test-runner.ts) — mirrors
 * /api/automation/runs/[runId]/screenshot/route.ts exactly: always re-derives a
 * FRESH signed URL from the stored `video_url` PATH (never a URL) on
 * automation_runs, then redirects to it, so a signed URL that expired 7 days ago
 * never silently rots in a bookmarked/shared link. A normal top-level `<a>`
 * navigation (not a cross-origin fetch) is what's expected to hit this route, so
 * the request carries the user's session cookie and RLS on automation_runs governs
 * access exactly as it does for the screenshot route.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const supabase = await createClient();

  const { data: run, error } = await supabase.from('automation_runs').select('video_url').eq('id', runId).maybeSingle();

  if (error || !run || !run.video_url) {
    return NextResponse.json({ success: false, error: 'Video not found' }, { status: 404 });
  }

  const freshUrl = await resignRunArtifactUrl(supabase, run.video_url);
  if (!freshUrl) {
    return NextResponse.json({ success: false, error: 'Unable to generate video URL' }, { status: 500 });
  }

  return NextResponse.redirect(freshUrl);
}
