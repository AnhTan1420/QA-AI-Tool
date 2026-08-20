import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { createClient } from '@/services/supabase/server';
import { processNextBatchItemSchema, type EnvironmentConfig } from '@/models/validators/playwright';
import { processClaimedBatchItem } from '@/services/automation/batch-runner';

// Kept at Vercel Hobby's actual ceiling (declaring higher is silently capped
// anyway on Hobby — see schema.sql's "Batch Automation" header comment).
// processClaimedBatchItem's own internal budget (50s) stays under this with
// headroom for the claim/update queries around it.
export const maxDuration = 60;
export const runtime = 'nodejs';

/**
 * Advances a batch by exactly ONE test case per call. There is deliberately no
 * loop inside this route — see schema.sql's "Batch Automation" section for why
 * (Vercel Hobby has no background worker and Cron only fires once/day, so the
 * browser tab itself must call this repeatedly until the queue is empty; a
 * batch left mid-way is simply "paused" and fully resumable later).
 *
 * SECURITY: cookie_token/login in the request body are used ONLY to build the
 * in-memory EnvironmentConfig passed to inspect/run for this one call — never
 * written to automation_batch_run_items, automation_batch_runs, or logged.
 * Same rule as environmentConfigSchema everywhere else in this codebase.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: batchId } = await params;
    const rawBody = await req.json();
    const input = processNextBatchItemSchema.parse({ ...rawBody, batch_id: batchId });

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Bạn cần đăng nhập.' }, { status: 401 });
    }

    const { data: batch, error: batchError } = await supabase
      .from('automation_batch_runs')
      .select('*')
      .eq('id', batchId)
      .maybeSingle();
    if (batchError || !batch) {
      return NextResponse.json({ success: false, error: 'Không tìm thấy batch.' }, { status: 404 });
    }

    // Atomic claim (FOR UPDATE SKIP LOCKED under the hood) — see schema.sql's
    // claim_next_batch_item. RLS/membership already enforced inside the function.
    const { data: claimedRows, error: claimError } = await supabase.rpc('claim_next_batch_item', {
      p_batch_id: batchId,
    });
    if (claimError) {
      return NextResponse.json({ success: false, error: claimError.message }, { status: 500 });
    }
    // Supabase RPC returning a single `setof`/row type comes back as an array.
    const claimed = Array.isArray(claimedRows) ? claimedRows[0] : claimedRows;

    if (!claimed) {
      // Nothing left queued — batch is done. Mark it completed (idempotent).
      await supabase.from('automation_batch_runs').update({ status: 'completed' }).eq('id', batchId);
      return NextResponse.json({ success: true, data: { done: true } });
    }

    const snapshot = batch.environment_snapshot as { browser: EnvironmentConfig['browser']; target_url: string; auth_mode: string };
    const environment: EnvironmentConfig = {
      browser: snapshot.browser,
      target_url: snapshot.target_url,
      cookie_token: snapshot.auth_mode === 'cookie' ? input.cookie_token : undefined,
      login: snapshot.auth_mode === 'login' ? input.login : undefined,
      // Batch automation ("process-next", one item per HTTP request — see the file
      // header above) is, for now, a serverless-only flow: the self-hosted "Full run"
      // batch path (concurrent, no per-request timeout) is a separate code path planned
      // for a later phase (see docs/automation-agent-rebuild.md §4.3) and isn't wired up
      // here yet, so this hardcodes 'serverless' rather than trusting an execution_mode
      // that might be present in an older environment_snapshot.
      execution_mode: 'serverless',
    };

    await supabase.from('automation_batch_runs').update({ status: 'running' }).eq('id', batchId).eq('status', 'queued');

    const result = await processClaimedBatchItem(supabase, claimed, environment, user.id, input.language);

    await supabase
      .from('automation_batch_run_items')
      .update({
        status: result.item_status,
        run_id: result.run_id,
        generate_error: result.generate_error,
        finished_at: new Date().toISOString(),
      })
      .eq('id', claimed.id);

    // Recompute counts from the item rows rather than incrementing in place —
    // cheap at batch sizes up to a few hundred, and immune to drift if a call
    // ever gets retried.
    const { data: allItems } = await supabase
      .from('automation_batch_run_items')
      .select('status')
      .eq('batch_id', batchId);
    const counts = { queued: 0, running: 0, passed: 0, failed: 0, error: 0, skipped: 0 };
    for (const row of allItems ?? []) {
      counts[row.status as keyof typeof counts] = (counts[row.status as keyof typeof counts] ?? 0) + 1;
    }
    const isDone = counts.queued === 0 && counts.running === 0;

    await supabase
      .from('automation_batch_runs')
      .update({
        queued_count: counts.queued,
        running_count: counts.running,
        passed_count: counts.passed,
        failed_count: counts.failed,
        error_count: counts.error,
        status: isDone ? 'completed' : 'running',
        updated_at: new Date().toISOString(),
      })
      .eq('id', batchId);

    return NextResponse.json({
      success: true,
      data: {
        done: isDone,
        item: { id: claimed.id, test_case_id: claimed.test_case_id, status: result.item_status, generate_error: result.generate_error },
        counts,
      },
    });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      const errorMessage =
        'Dữ liệu đầu vào không hợp lệ: ' + error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      return NextResponse.json({ success: false, error: errorMessage, details: error.issues }, { status: 400 });
    }
    const failureMessage = error instanceof Error ? error.message : 'Không thể xử lý batch item';
    console.error('❌ Lỗi API Batch Process-Next:', failureMessage);
    return NextResponse.json({ success: false, error: failureMessage }, { status: 500 });
  }
}
