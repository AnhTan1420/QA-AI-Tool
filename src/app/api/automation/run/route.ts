import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { runRequestSchema, type PageObject, type FailureDetails, assertExecutionModeAllowed } from '@/models/validators/playwright';
import { runGeneratedScript } from '@/services/automation/browser-runner';
import { runGeneratedScriptSelfHosted } from '@/services/automation/playwright-test-runner';
import { uploadRunScreenshot } from '@/services/automation/screenshot-storage';
import { uploadRunArtifact } from '@/services/automation/run-artifact-storage';
import { createClient } from '@/services/supabase/server';
import { checkRunRateLimit } from '@/services/automation/rate-limit';

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

    // Basic per-user cooldown - each run holds a real headless browser for up to
    // 45s (see AUDIT_REPORT.md item H). Best-effort, in-memory, non-global - see
    // lib/automation/rate-limit.ts doc comment for exact scope/limitations.
    const rateLimit = checkRunRateLimit(user.id);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        {
          success: false,
          error: `Vui lòng đợi ${Math.ceil(rateLimit.retryAfterMs / 1000)}s trước khi chạy automation tiếp theo (tránh chạy quá nhiều browser cùng lúc).`,
        },
        { status: 429 },
      );
    }

    // Resolve the code to run: an explicit ad-hoc `code` (+ `page_objects`) payload, or
    // a saved automation_scripts version (RLS already scopes this select to project
    // members). Page Objects travel WITH the spec code from here on - see
    // lib/automation/browser-runner.ts#runGeneratedScript, which compiles them into the
    // same execution scope as the spec body.
    let codeToRun = input.code ?? null;
    let pageObjectsToRun: PageObject[] = input.page_objects ?? [];
    let scriptId = input.script_id ?? null;

    if (!codeToRun && scriptId) {
      const { data: script, error: scriptError } = await supabase
        .from('automation_scripts')
        .select('id, code, page_objects, test_case_id, status')
        .eq('id', scriptId)
        .is('deleted_at', null)
        .maybeSingle();

      if (scriptError || !script || script.test_case_id !== input.test_case_id) {
        return NextResponse.json({ success: false, error: 'Không tìm thấy script để chạy.' }, { status: 404 });
      }
      // "Review Gate" state machine (defense-in-depth, not just a UI-level
      // disabled button): a script fresh out of AI generation/edit-save
      // starts 'pending_review' and must be explicitly reviewed - "Approve &
      // Run" (PATCH .../scripts/[scriptId]) or "Edit / Tweak" (POST
      // .../scripts, which self-approves on save) - before it's allowed to
      // execute here. Batch Automation calls a different, lower-level code
      // path (runGeneratedScript directly) and is unaffected by this gate.
      if (script.status !== 'approved') {
        return NextResponse.json(
          { success: false, error: 'Script này đang chờ review (pending_review). Hãy Approve hoặc Edit & Save trước khi Run.' },
          { status: 409 },
        );
      }
      codeToRun = script.code;
      pageObjectsToRun = (script.page_objects as PageObject[] | null) ?? [];
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

    // Dual-mode execution (Automation Agent Rebuild §4.2/§4.3): 'serverless' keeps the
    // existing eval-based runner exactly as-is (repositioned as "Preview" in the UI -
    // fast, works on Vercel Hobby, but not a real @playwright/test execution). 'self_hosted'
    // spawns a REAL `npx playwright test` child process with trace/video/retry/HTML
    // report - only reachable when assertExecutionModeAllowed('self_hosted') doesn't
    // throw. runRequestSchema's environmentConfigSchema already re-checks this via its
    // own .refine() at the parse step above; this second call is defense-in-depth
    // (same posture as the rest of this route re-checking things Zod already checked),
    // never the ONLY enforcement point.
    assertExecutionModeAllowed(input.environment.execution_mode);
    const isSelfHosted = input.environment.execution_mode === 'self_hosted';

    type UnifiedOutcome = {
      status: 'passed' | 'failed' | 'error' | 'flaky';
      duration_ms: number;
      attempts: number;
      screenshotBuffer?: Buffer;
      traceBuffer?: Buffer;
      videoBuffer?: Buffer;
      htmlReportBuffer?: Buffer;
      failure_details?: FailureDetails;
      extraWarnings: string[];
    };

    const outcome: UnifiedOutcome = isSelfHosted
      ? await (async () => {
          const r = await runGeneratedScriptSelfHosted({ code: codeToRun!, page_objects: pageObjectsToRun }, input.environment);
          return {
            status: r.status,
            duration_ms: r.duration_ms,
            attempts: r.attempts,
            screenshotBuffer: r.screenshotBuffer,
            traceBuffer: r.traceBuffer,
            videoBuffer: r.videoBuffer,
            htmlReportBuffer: r.htmlReportBuffer,
            failure_details: r.failure_details,
            extraWarnings: r.warnings,
          };
        })()
      : await (async () => {
          const r = await runGeneratedScript({ code: codeToRun!, page_objects: pageObjectsToRun }, input.environment);
          return {
            status: r.status,
            duration_ms: r.duration_ms,
            attempts: 1,
            screenshotBuffer: r.screenshotBuffer,
            failure_details: r.failure_details,
            extraWarnings: [] as string[],
          };
        })();

    // Insert the run row first (without artifact URLs) so we always have a run_id to
    // key each artifact's storage path on.
    const { data: runRow, error: insertError } = await supabase
      .from('automation_runs')
      .insert({
        test_case_id: input.test_case_id,
        script_id: scriptId,
        status: outcome.status,
        duration_ms: outcome.duration_ms,
        failure_details: outcome.failure_details ?? null,
        code_snapshot: codeToRun,
        page_objects_snapshot: pageObjectsToRun,
        run_by: user.id,
        finished_at: new Date().toISOString(),
        attempts: outcome.attempts,
        is_flaky: outcome.status === 'flaky',
        execution_mode: input.environment.execution_mode,
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

    // Self-hosted-only artifacts. Each upload is independent/best-effort - a failure on
    // one (e.g. video) must never block the trace or the run result itself from being
    // usable, so each gets its own try/catch rather than one wrapping all three.
    let traceUrl: string | null = null;
    let videoUrl: string | null = null;
    let htmlReportUrl: string | null = null;

    if (outcome.traceBuffer) {
      try {
        const uploaded = await uploadRunArtifact(supabase, input.test_case_id, runRow.id, 'trace', outcome.traceBuffer);
        traceUrl = uploaded.signedUrl;
        await supabase.from('automation_runs').update({ trace_url: uploaded.path }).eq('id', runRow.id);
      } catch (uploadErr) {
        console.error('[automation/run] Lỗi upload trace:', uploadErr);
      }
    }
    if (outcome.videoBuffer) {
      try {
        const uploaded = await uploadRunArtifact(supabase, input.test_case_id, runRow.id, 'video', outcome.videoBuffer);
        videoUrl = uploaded.signedUrl;
        await supabase.from('automation_runs').update({ video_url: uploaded.path }).eq('id', runRow.id);
      } catch (uploadErr) {
        console.error('[automation/run] Lỗi upload video:', uploadErr);
      }
    }
    if (outcome.htmlReportBuffer) {
      try {
        const uploaded = await uploadRunArtifact(supabase, input.test_case_id, runRow.id, 'html_report', outcome.htmlReportBuffer);
        htmlReportUrl = uploaded.signedUrl;
        await supabase.from('automation_runs').update({ html_report_url: uploaded.path }).eq('id', runRow.id);
      } catch (uploadErr) {
        console.error('[automation/run] Lỗi upload HTML report:', uploadErr);
      }
    }

    // Badge trên library list: passed/failed thắng thế so với "generated" cũ. 'flaky'
    // được coi là "passed" ở mức badge tổng quan (automation_status không có giá trị
    // 'flaky' - xem CHECK constraint trong schema.sql) - test RỐT CUỘC đã pass, nhưng
    // sự bất ổn định vẫn được giữ nguyên và hiển thị rõ ở automation_runs.is_flaky/status
    // cho ai xem chi tiết run. Một run 'error' (không chạy được, không phải fail nghiệp
    // vụ) vẫn hiển thị "failed" để nhắc QA quay lại xử lý.
    const badgeStatus = outcome.status === 'passed' || outcome.status === 'flaky' ? 'passed' : 'failed';
    await supabase.from('test_cases').update({ automation_status: badgeStatus }).eq('id', input.test_case_id);

    return NextResponse.json({
      success: true,
      data: {
        run_id: runRow.id,
        status: outcome.status,
        duration_ms: outcome.duration_ms,
        attempts: outcome.attempts,
        execution_mode: input.environment.execution_mode,
        screenshot_url: screenshotUrl,
        trace_url: traceUrl,
        video_url: videoUrl,
        html_report_url: htmlReportUrl,
        failure_details: outcome.failure_details ?? null,
        warnings: outcome.extraWarnings,
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
