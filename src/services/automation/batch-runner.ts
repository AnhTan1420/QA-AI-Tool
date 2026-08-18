import type { SupabaseClient } from '@supabase/supabase-js';
import { inspectEnvironment, runGeneratedScript } from '@/services/automation/browser-runner';
import { uploadRunScreenshot } from '@/services/automation/screenshot-storage';
import { runAIAgent } from '@/services/ai/provider';
import { buildPlaywrightCodegenPrompt, groupElementMapByPage } from '@/services/ai/prompts/playwright-agent';
import { buildPlaywrightResponseSchema } from '@/services/ai/prompts/playwright-response-schema';
import { playwrightScriptSchema, type EnvironmentConfig, type PageObject } from '@/models/validators/playwright';

/**
 * Wall-clock budget for a single process-next call. Deliberately well under
 * Vercel Hobby's hard 60s ceiling (see schema.sql's "Batch Automation" header
 * comment): if there isn't enough of this budget left before starting the next
 * step, we bail out and mark the item 'error' (retryable via Resume) instead of
 * letting the platform hard-kill the function mid-step, which would leave the
 * item stuck at 'running' with zero result recorded.
 */
const BATCH_ITEM_BUDGET_MS = 50_000;
// Rough floor of time a step realistically needs to even attempt without being
// pointless to start — not a promise it'll finish, just a "don't bother" guard.
const MIN_STEP_BUDGET_MS = 8_000;

export type ProcessBatchItemResult = {
  item_status: 'passed' | 'failed' | 'error' | 'skipped';
  run_id: string | null;
  generate_error: string | null;
};

type BatchItemRow = {
  id: string;
  test_case_id: string;
};

/**
 * Processes exactly ONE claimed batch item end-to-end: reuses the same saved
 * automation_scripts row if one already exists, otherwise Inspects the
 * environment + Generates a script first (identical calls to what the single
 * test-case Automation tab does via /api/automation/inspect + /api/ai/playwright
 * + /api/automation/run — see hooks/test-case/use-automation.ts),
 * then always Runs and persists to automation_runs exactly like
 * app/api/automation/run/route.ts does.
 *
 * Deliberately does NOT assume test cases in a batch share one element map —
 * each item gets its own fresh Inspect when it has no saved script yet. This is
 * the safer, more general default (correct even when test cases in the batch
 * live on different screens of the app), at the cost of being slower per item.
 */
export async function processClaimedBatchItem(
  supabase: SupabaseClient,
  item: BatchItemRow,
  environment: EnvironmentConfig,
  userId: string,
  locale: 'vi' | 'en',
): Promise<ProcessBatchItemResult> {
  const startedAt = Date.now();
  const timeLeft = () => BATCH_ITEM_BUDGET_MS - (Date.now() - startedAt);

  const { data: testCase, error: testCaseError } = await supabase
    .from('test_cases')
    .select('id, title, preconditions, steps, expected_result')
    .eq('id', item.test_case_id)
    .maybeSingle();
  if (testCaseError || !testCase) {
    return { item_status: 'error', run_id: null, generate_error: 'Test case không tồn tại hoặc không có quyền truy cập.' };
  }

  // Reuse the latest saved script if this test case already has one (from a
  // prior single-case Generate, or a prior batch run) — skips Inspect+Generate
  // entirely, which is both faster and cheaper. Filters out soft-deleted rows
  // (deleted_at) for the same reason the single-case routes do (see
  // app/api/test-cases/[id]/automation/scripts/route.ts) — otherwise a batch
  // could "reuse" a script the user had already deleted.
  const { data: existingScript } = await supabase
    .from('automation_scripts')
    .select('id, code, page_objects')
    .eq('test_case_id', item.test_case_id)
    .is('deleted_at', null)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  let codeToRun: string;
  let pageObjectsToRun: PageObject[];
  let scriptId: string | null = null;

  if (existingScript) {
    codeToRun = existingScript.code;
    pageObjectsToRun = (existingScript.page_objects as PageObject[] | null) ?? [];
    scriptId = existingScript.id;
  } else {
    if (timeLeft() < MIN_STEP_BUDGET_MS * 2) {
      // Not even enough budget left to attempt Inspect + Generate — bail before
      // starting rather than getting hard-killed partway through either.
      return {
        item_status: 'error',
        run_id: null,
        generate_error: 'Hết thời gian xử lý trước khi kịp Inspect + Generate. Bấm Resume để thử lại test case này.',
      };
    }

    let elementMap;
    try {
      // Same default as the interactive Inspect flow (use-automation.ts) - see
      // autoExpandTriggers() in browser-runner.ts for why this is safe to default on.
      const inspected = await inspectEnvironment(environment, [], undefined, { enabled: true, max_triggers: 5 });
      elementMap = inspected.element_map;
    } catch (err: any) {
      return { item_status: 'error', run_id: null, generate_error: `Inspect thất bại: ${String(err?.message ?? err)}` };
    }

    if (elementMap.length === 0) {
      return {
        item_status: 'error',
        run_id: null,
        generate_error: 'Inspect không tìm thấy element nào trên trang — không đủ căn cứ để sinh Playwright code.',
      };
    }

    if (timeLeft() < MIN_STEP_BUDGET_MS) {
      return {
        item_status: 'error',
        run_id: null,
        generate_error: 'Hết thời gian xử lý sau khi Inspect, chưa kịp Generate code. Bấm Resume để thử lại.',
      };
    }

    try {
      const promptInput = {
        test_case: {
          title: testCase.title,
          preconditions: (testCase.preconditions as string[] | null) ?? [],
          steps: testCase.steps as { step_number: number; action: string; expected_result: string }[],
          expected_result: testCase.expected_result ?? '',
        },
        element_map: elementMap,
        environment: { browser: environment.browser, target_url: environment.target_url, auth_mode: environment.cookie_token ? ('cookie' as const) : environment.login ? ('login' as const) : ('none' as const) },
        language: locale === 'vi' ? 'Tiếng Việt' : 'English',
      };
      const promptString = buildPlaywrightCodegenPrompt(promptInput);
      const aiRawResult = await runAIAgent(promptString, 'playwright_codegen', buildPlaywrightResponseSchema());

      let rawJsonObject: Record<string, unknown> | null = null;
      if (typeof aiRawResult === 'string') {
        try {
          rawJsonObject = JSON.parse(aiRawResult.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim());
        } catch {
          rawJsonObject = null;
        }
      } else if (aiRawResult && typeof aiRawResult === 'object') {
        rawJsonObject = aiRawResult as Record<string, unknown>;
      }

      const parsed = playwrightScriptSchema.safeParse(rawJsonObject);
      if (!parsed.success) {
        return { item_status: 'error', run_id: null, generate_error: 'AI trả về dữ liệu không đúng định dạng Playwright script.' };
      }

      // Same defense-in-depth Page Object identity check as app/api/ai/playwright/route.ts —
      // cross-check rather than reject, so a drifted name doesn't throw away an
      // otherwise-runnable generation.
      const expectedRoster = groupElementMapByPage(elementMap);
      const expectedNames = new Set(expectedRoster.map((g) => g.class_name));
      const actualNames = new Set(parsed.data.page_objects.map((po) => po.class_name));
      const rosterWarnings: string[] = [];
      if (expectedRoster.length > 0 && parsed.data.page_objects.length === 0) {
        rosterWarnings.push('AI không trả về Page Object nào dù element map có dữ liệu.');
      }
      for (const name of expectedNames) {
        if (!actualNames.has(name)) rosterWarnings.push(`Thiếu Page Object dự kiến "${name}".`);
      }
      if (rosterWarnings.length > 0) parsed.data.warnings = [...parsed.data.warnings, ...rosterWarnings];

      const { data: existingVersion } = await supabase
        .from('automation_scripts')
        .select('version')
        .eq('test_case_id', item.test_case_id)
        .is('deleted_at', null)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextVersion = (existingVersion?.version ?? 0) + 1;

      const { data: saved, error: saveError } = await supabase
        .from('automation_scripts')
        .insert({
          test_case_id: item.test_case_id,
          version: nextVersion,
          page_objects: parsed.data.page_objects,
          code: parsed.data.code,
          imports_used: parsed.data.imports_used,
          selectors_used: parsed.data.selectors_used,
          warnings: parsed.data.warnings,
          environment: promptInput.environment,
          element_map: elementMap,
          model_used: process.env.AI_MODEL_PLAYWRIGHT_CODEGEN ?? null,
          generated_by: userId,
        })
        .select('id')
        .single();
      if (saveError || !saved) {
        return { item_status: 'error', run_id: null, generate_error: `Không thể lưu script đã sinh: ${saveError?.message ?? 'unknown'}` };
      }

      codeToRun = parsed.data.code;
      pageObjectsToRun = parsed.data.page_objects;
      scriptId = saved.id;
      await supabase
        .from('test_cases')
        .update({ automation_status: 'generated' })
        .eq('id', item.test_case_id)
        .eq('automation_status', 'not_generated');
    } catch (err: any) {
      return { item_status: 'error', run_id: null, generate_error: `Generate thất bại: ${String(err?.message ?? err)}` };
    }
  }

  if (timeLeft() < MIN_STEP_BUDGET_MS) {
    return {
      item_status: 'error',
      run_id: null,
      generate_error: 'Hết thời gian xử lý trước khi kịp Run test. Bấm Resume để thử lại test case này.',
    };
  }

  // ── Run — identical persistence shape to app/api/automation/run/route.ts ──
  const outcome = await runGeneratedScript({ code: codeToRun, page_objects: pageObjectsToRun }, environment);

  const { data: runRow, error: insertError } = await supabase
    .from('automation_runs')
    .insert({
      test_case_id: item.test_case_id,
      script_id: scriptId,
      status: outcome.status,
      duration_ms: outcome.duration_ms,
      failure_details: outcome.failure_details ?? null,
      code_snapshot: codeToRun,
      page_objects_snapshot: pageObjectsToRun,
      run_by: userId,
      finished_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (insertError || !runRow) {
    return { item_status: 'error', run_id: null, generate_error: `Không thể lưu kết quả run: ${insertError?.message ?? 'unknown'}` };
  }

  if (outcome.screenshotBuffer) {
    try {
      const uploaded = await uploadRunScreenshot(supabase, item.test_case_id, runRow.id, outcome.screenshotBuffer);
      await supabase.from('automation_runs').update({ screenshot_url: uploaded.path }).eq('id', runRow.id);
    } catch (uploadErr) {
      console.error('[batch-runner] Lỗi upload screenshot:', uploadErr);
    }
  }

  const badgeStatus = outcome.status === 'passed' ? 'passed' : 'failed';
  await supabase.from('test_cases').update({ automation_status: badgeStatus }).eq('id', item.test_case_id);

  return { item_status: outcome.status, run_id: runRow.id, generate_error: null };
}
