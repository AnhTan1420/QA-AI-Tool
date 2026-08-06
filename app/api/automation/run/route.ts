import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { runRequestSchema } from '@/lib/validators/playwright';
import { runGeneratedScript } from '@/lib/automation/browser-runner';
import { uploadRunScreenshot } from '@/lib/automation/screenshot-storage';
import { createClient } from '@/lib/supabase/server';

export const maxDuration = 120;
export const runtime = 'nodejs';

/**
 * "Run Automation Test" action (Requirement 4): executes a generated Playwright
 * script against the given environment (via the runner architecture picked in
 * lib/automation/browser-runner.ts), captures a screenshot (final-state on pass,
 * failing-element highlighted on fail), and persists everything to
 * automation_runs - RLS on that table (schema.sql) enforces the same
 * project_members chain as test_cases/test_case_versions.
 */
export async function POST(req: Request) {
  try {
    const rawBody = await req.json();
    const input = runRequestSchema.parse(rawBody);

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Bạn cần đăng nhập.' }, { status: 401 });
    }

    // Resolve the code to run: an explicit ad-hoc `code` payload, or a saved
    // automation_scripts version (RLS already scopes this select to project members).
    let codeToRun = input.code ?? null;
    let scriptId = input.script_id ?? null;

    if (!codeToRun && scriptId) {
      const { data: script, error: scriptError } = await supabase
        .from('automation_scripts')
        .select('id, code, test_case_id')
        .eq('id', scriptId)
        .maybeSingle();

      if (scriptError || !script || script.test_case_id !== input.test_case_id) {
        return NextResponse.json({ success: false, error: 'Không tìm thấy script để chạy.' }, { status: 404 });
      }
      codeToRun = script.code;
    }

    if (!codeToRun) {
      return NextResponse.json({ success: false, error: 'Thiếu code để chạy.' }, { status: 400 });
    }

    // Confirm the test case exists / is accessible before spending time launching a browser.
    const { data: testCase, error: testCaseError } = await supabase
      .from('test_cases')
      .select('id')
      .eq('id', input.test_case_id)
      .maybeSingle();
    if (testCaseError || !testCase) {
      return NextResponse.json({ success: false, error: 'Test case không tồn tại hoặc bạn không có quyền truy cập.' }, { status: 404 });
    }

    const outcome = await runGeneratedScript(codeToRun, input.environment);

    // Insert the run row first (without screenshot_url) so we always have a
    // run_id to key the screenshot's storage path on.
    const { data: runRow, error: insertError } = await supabase
      .from('automation_runs')
      .insert({
        test_case_id: input.test_case_id,
        script_id: scriptId,
        status: outcome.status,
        duration_ms: outcome.duration_ms,
        failure_details: outcome.failure_details ?? null,
        code_snapshot: codeToRun,
        run_by: user.id,
        finished_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (insertError || !runRow) {
      return NextResponse.json({ success: false, error: insertError?.message ?? 'Không thể lưu kết quả chạy.' }, { status: 500 });
    }

    let screenshotUrl: string | null = null;
    if (outcome.screenshotBuffer) {
      try {
        const uploaded = await uploadRunScreenshot(supabase, input.test_case_id, runRow.id, outcome.screenshotBuffer);
        screenshotUrl = uploaded.signedUrl;
        await supabase.from('automation_runs').update({ screenshot_url: uploaded.path }).eq('id', runRow.id);
      } catch (uploadErr) {
        console.error('[automation/run] Lỗi upload screenshot:', uploadErr);
      }
    }

    // Badge trên library list: passed/failed thắng thế so với "generated" cũ; một
    // run 'error' (không chạy được, không phải fail nghiệp vụ) vẫn hiển thị "failed"
    // để nhắc QA quay lại xử lý, nhưng chi tiết thật (status='error') vẫn giữ nguyên trong automation_runs.
    const badgeStatus = outcome.status === 'passed' ? 'passed' : 'failed';
    await supabase.from('test_cases').update({ automation_status: badgeStatus }).eq('id', input.test_case_id);

    return NextResponse.json({
      success: true,
      data: {
        run_id: runRow.id,
        status: outcome.status,
        duration_ms: outcome.duration_ms,
        screenshot_url: screenshotUrl,
        failure_details: outcome.failure_details ?? null,
      },
    });
  } catch (error: unknown) {
    if (error instanceof ZodError) {
      const errorMessage =
        'Dữ liệu đầu vào không hợp lệ: ' + error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      return NextResponse.json({ success: false, error: errorMessage, details: error.issues }, { status: 400 });
    }

    const failureMessage = error instanceof Error ? error.message : 'Không thể chạy automation test';
    console.error('❌ Lỗi API Automation Run:', failureMessage);
    return NextResponse.json({ success: false, error: failureMessage }, { status: 500 });
  }
}
