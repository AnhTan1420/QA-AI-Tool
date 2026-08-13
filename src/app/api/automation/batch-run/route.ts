import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { createClient } from '@/services/supabase/server';
import { createBatchRunSchema } from '@/models/validators/playwright';

export const runtime = 'nodejs';

/**
 * "Run Automation on N test cases" (Phase 4 roadmap item). This route ONLY
 * enqueues — it inserts automation_batch_runs + one automation_batch_run_items
 * row per test case, then returns immediately. It deliberately does NOT launch
 * a single browser itself: with up to ~100 test cases selected, doing that
 * synchronously here would blow well past Vercel Hobby's 60s cap on the very
 * first request. The actual work happens one test case at a time via repeated
 * calls to POST /api/automation/batch-run/[id]/process-next — see that route's
 * doc comment, and the "Batch Automation" section header comment in schema.sql,
 * for why this project has no server-side background worker to drive that loop
 * and instead relies on the browser tab polling it.
 */
export async function POST(req: Request) {
  try {
    const rawBody = await req.json();
    const input = createBatchRunSchema.parse(rawBody);

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Bạn cần đăng nhập.' }, { status: 401 });
    }

    // Snapshot the environment's PUBLIC config now (see environment_snapshot
    // column comment in schema.sql) — RLS also confirms the caller can see it.
    const { data: env, error: envError } = await supabase
      .from('project_environments')
      .select('id, project_id, browser, target_url, auth_mode')
      .eq('id', input.environment_id)
      .eq('project_id', input.project_id)
      .maybeSingle();
    if (envError || !env) {
      return NextResponse.json({ success: false, error: 'Không tìm thấy environment đã chọn.' }, { status: 404 });
    }

    // Confirm every selected test case actually belongs to this project (RLS
    // scopes the select; a short result vs. requested length means at least
    // one id was invalid/inaccessible) before creating the batch.
    const { data: validCases, error: casesError } = await supabase
      .from('test_cases')
      .select('id, set_id, test_case_sets!inner(project_id)')
      .in('id', input.test_case_ids)
      .eq('test_case_sets.project_id', input.project_id);
    if (casesError) {
      return NextResponse.json({ success: false, error: casesError.message }, { status: 500 });
    }
    const validIds = new Set((validCases ?? []).map((c) => c.id));
    const orderedValidIds = input.test_case_ids.filter((id) => validIds.has(id));
    if (orderedValidIds.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Không có test case hợp lệ nào trong project này để chạy automation.' },
        { status: 400 },
      );
    }

    const { data: batch, error: batchError } = await supabase
      .from('automation_batch_runs')
      .insert({
        project_id: input.project_id,
        environment_id: env.id,
        environment_snapshot: { browser: env.browser, target_url: env.target_url, auth_mode: env.auth_mode },
        total_count: orderedValidIds.length,
        queued_count: orderedValidIds.length,
        status: 'queued',
        created_by: user.id,
      })
      .select('id')
      .single();
    if (batchError || !batch) {
      return NextResponse.json({ success: false, error: batchError?.message ?? 'Không thể tạo batch.' }, { status: 500 });
    }

    const items = orderedValidIds.map((testCaseId, index) => ({
      batch_id: batch.id,
      test_case_id: testCaseId,
      position: index,
      status: 'queued' as const,
    }));
    const { error: itemsError } = await supabase.from('automation_batch_run_items').insert(items);
    if (itemsError) {
      // Best-effort rollback of the parent row so a failed insert doesn't leave
      // an empty, permanently-stuck-at-0-items batch behind.
      await supabase.from('automation_batch_runs').delete().eq('id', batch.id);
      return NextResponse.json({ success: false, error: itemsError.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      data: { batch_id: batch.id, total_count: orderedValidIds.length, skipped_count: input.test_case_ids.length - orderedValidIds.length },
    });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      const errorMessage =
        'Dữ liệu đầu vào không hợp lệ: ' + error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      return NextResponse.json({ success: false, error: errorMessage, details: error.issues }, { status: 400 });
    }
    const failureMessage = error instanceof Error ? error.message : 'Không thể tạo batch automation run';
    console.error('❌ Lỗi API Batch Run Create:', failureMessage);
    return NextResponse.json({ success: false, error: failureMessage }, { status: 500 });
  }
}

/** GET /api/automation/batch-run?id=... — poll batch progress + item list. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) {
    return NextResponse.json({ success: false, error: 'Thiếu id' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: batch, error: batchError } = await supabase
    .from('automation_batch_runs')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (batchError || !batch) {
    return NextResponse.json({ success: false, error: 'Không tìm thấy batch.' }, { status: 404 });
  }

  const { data: items, error: itemsError } = await supabase
    .from('automation_batch_run_items')
    .select('id, test_case_id, position, status, generate_error, run_id, started_at, finished_at, test_cases(code, title)')
    .eq('batch_id', id)
    .order('position', { ascending: true });
  if (itemsError) {
    return NextResponse.json({ success: false, error: itemsError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: { batch, items } });
}
