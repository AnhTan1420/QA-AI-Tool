import { NextResponse } from 'next/server';
import { createClient } from '@/services/supabase/server';
import { resignRunArtifactUrl } from '@/services/automation/run-artifact-storage';

/**
 * GET /api/automation/runs/[runId]/html-report
 *
 * Self-hosted "Full run" only — same lazy-resign pattern as the screenshot/video
 * routes. The stored artifact is a ZIP of the whole `playwright-report/` static
 * site (not a single viewable page — see run-result.tsx's "download, don't open"
 * framing for the same reason), so this redirects to a signed download URL rather
 * than something meant to render inline.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const supabase = await createClient();

  const { data: run, error } = await supabase.from('automation_runs').select('html_report_url').eq('id', runId).maybeSingle();

  if (error || !run || !run.html_report_url) {
    return NextResponse.json({ success: false, error: 'HTML report not found' }, { status: 404 });
  }

  const freshUrl = await resignRunArtifactUrl(supabase, run.html_report_url);
  if (!freshUrl) {
    return NextResponse.json({ success: false, error: 'Unable to generate HTML report URL' }, { status: 500 });
  }

  return NextResponse.redirect(freshUrl);
}
