import { NextResponse } from 'next/server';
import { createClient } from '@/services/supabase/server';
import { deleteRunScreenshot } from '@/services/automation/screenshot-storage';
import { deleteRunArtifact } from '@/services/automation/run-artifact-storage';

/**
 * DELETE /api/automation/runs/[runId]
 *
 * Hard-deletes one "Run Automation Test" history record. Unlike
 * DELETE .../automation/scripts/[scriptId] (soft delete - sets deleted_at,
 * deliberately KEEPS run history intact so old runs still show what actually
 * ran), a run record here IS the thing the user asked to delete, so this also
 * frees the real storage bytes it owns: screenshot_url (bucket
 * "automation-screenshots" or R2 "screenshots/...") and video_url/
 * html_report_url/trace_url (bucket "automation-run-artifacts" or R2
 * "run-artifacts/..." - self-hosted "Full run" only, all three are null for
 * serverless_preview runs). deleteRunScreenshot()/deleteRunArtifact() each
 * dispatch to whichever backend actually stored the given path (same
 * dispatch-by-prefix logic resignScreenshotUrl()/resignRunArtifactUrl() use
 * for reads), so this route works the same regardless of whether R2 is
 * configured for this deployment.
 *
 * RLS (automation_runs_member_access, "for all") already scopes the SELECT
 * below to rows the caller's project membership can see, so a runId belonging
 * to a project the caller isn't in simply isn't returned - that doubles as
 * the authorization check, same as the sibling screenshot/video/html-report
 * GET routes in this folder.
 *
 * Ordering: storage cleanup runs BEFORE the DB delete, not after. Both
 * deleteRunScreenshot() and deleteRunArtifact() treat an already-missing key
 * as success (see their doc comments), so if the DB delete below fails for
 * some reason, the row survives and a retry safely re-attempts storage
 * cleanup as a no-op before trying the DB delete again. Deleting the DB row
 * first would risk the opposite, worse failure mode: a row gone with no
 * record left to retry against, and its bytes orphaned in storage forever.
 */
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
