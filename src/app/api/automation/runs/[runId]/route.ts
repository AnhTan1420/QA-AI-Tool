import { NextResponse } from 'next/server';
import { createClient } from '@/services/supabase/server';
import { deleteRunScreenshot } from '@/services/automation/screenshot-storage';
import { deleteRunArtifact } from '@/services/automation/run-artifact-storage';

export async function DELETE(_req: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

  const { data: run, error: findError } = await supabase
    .from('automation_runs')
    .select('id, screenshot_url, video_url, html_report_url, trace_url')
    .eq('id', runId)
    .maybeSingle();

  if (findError || !run) {
    return NextResponse.json({ success: false, error: 'Run not found' }, { status: 404 });
  }

  // Best-effort, one artifact at a time - a single missing/already-deleted key
  // (e.g. retrying after a partial earlier failure) must never stop the others
  // from being attempted, and must never block the DB delete below.
  const storageWarnings: string[] = [];

  if (run.screenshot_url) {
    await deleteRunScreenshot(supabase, run.screenshot_url).catch((err) => {
      storageWarnings.push(`screenshot: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  const artifacts: Array<['video' | 'html_report' | 'trace', string | null]> = [
    ['video', run.video_url],
    ['html_report', run.html_report_url],
    ['trace', run.trace_url],
  ];
  for (const [kind, path] of artifacts) {
    if (!path) continue;
    await deleteRunArtifact(supabase, path).catch((err) => {
      storageWarnings.push(`${kind}: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  const { error: deleteError } = await supabase.from('automation_runs').delete().eq('id', runId);
  if (deleteError) {
    return NextResponse.json(
      { success: false, error: deleteError.message, storageWarnings },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    storageWarnings: storageWarnings.length ? storageWarnings : undefined,
  });
}
