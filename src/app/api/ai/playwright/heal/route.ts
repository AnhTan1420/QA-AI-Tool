import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { runAIAgent } from '@/services/ai/provider';
import { buildPlaywrightCodegenPrompt, groupElementMapByPage, checkSelectorAttribution } from '@/services/ai/prompts/playwright-agent';
import { buildPlaywrightResponseSchema } from '@/services/ai/prompts/playwright-response-schema';
import { playwrightHealRequestSchema, playwrightScriptSchema } from '@/models/validators/playwright';
import { createClient } from '@/services/supabase/server';
import { uploadScriptToR2, isR2Configured } from '@/services/automation/r2-storage';

export const maxDuration = 120;
export const runtime = 'nodejs';

/**
 * "Playwright Test Healer" (Phase 4.5 roadmap item) — the product-facing counterpart
 * to the qa-healer subagent in .claude/agents/ (see docs/e2e-agents.md), which heals
 * THIS repo's own tests. This route heals a script QAJD generated on behalf of a user,
 * for a test case that already ran and failed.
 *
 * Deliberately a SEPARATE route from /api/ai/playwright rather than a `mode` flag on
 * it: the request shape genuinely differs (requires `previous_code` +
 * `previous_page_objects` + `failure`, always requires `test_case_id`, element_map
 * must be a FRESH re-inspection taken right before calling this — never the map that
 * grounded the version that just failed), and keeping it separate means a bug in heal
 * logic can never regress the plain first-time-generation path.
 *
 * Client flow (see hooks/test-case/use-automation.ts#healAndRetry):
 * 1) Re-run Inspect (fresh element map — the DOM may have drifted since the failing
 *    script was generated, which is the most common real cause of a heal being needed).
 * 2) Call this route with that fresh map + the failing run's failure_details + the
 *    previous code/page_objects.
 * 3) Result is Zod-validated and saved as a new automation_scripts version, same
 *    'pending_review' Review Gate as a normal Generate — heal never bypasses review.
 * 4) The client then approves + runs it in the same click ("Heal & Retry"), same
 *    one-click precedent as "Approve & Run".
 */
export async function POST(req: Request) {
  try {
    const rawBody = await req.json();

    // 1) Validate INPUT
    const input = playwrightHealRequestSchema.parse(rawBody);

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Bạn cần đăng nhập.' }, { status: 401 });
    }

    // Confirm the test case exists / is accessible (RLS-scoped) before spending an AI call.
    const { data: testCase, error: testCaseError } = await supabase
      .from('test_cases')
      .select('id')
      .eq('id', input.test_case_id)
      .maybeSingle();
    if (testCaseError || !testCase) {
      return NextResponse.json({ success: false, error: 'Test case không tồn tại hoặc bạn không có quyền truy cập.' }, { status: 404 });
    }

    // 2) Build prompt (HEAL MODE section — see playwright-agent.ts) + call AI Provider
    const promptString = buildPlaywrightCodegenPrompt({
      test_case: input.test_case,
      element_map: input.element_map,
      environment: input.environment,
      language: input.language,
      heal: {
        previous_code: input.previous_code,
        previous_page_objects: input.previous_page_objects,
        failure: input.failure,
      },
    });
    const aiRawResult = await runAIAgent(promptString, 'playwright_heal', buildPlaywrightResponseSchema());

    let rawJsonObject: Record<string, unknown> | null = null;
    if (typeof aiRawResult === 'string') {
      try {
        const cleaned = aiRawResult.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();
        rawJsonObject = JSON.parse(cleaned);
      } catch {
        rawJsonObject = null;
      }
    } else if (aiRawResult && typeof aiRawResult === 'object') {
      rawJsonObject = aiRawResult as Record<string, unknown>;
    }

    // 3) Zod-validate OUTPUT — same contract/schema as a normal generation, never trust raw AI JSON
    const parsed = playwrightScriptSchema.safeParse(rawJsonObject);
    if (!parsed.success) {
      console.error('[ai/playwright/heal] AI trả về JSON sai schema:', parsed.error.issues);
      return NextResponse.json(
        {
          success: false,
          error: 'AI trả về dữ liệu không đúng định dạng Playwright script khi heal. Vui lòng thử lại.',
          details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        { status: 502 },
      );
    }

    // 3b) Same defense-in-depth Page Object identity + goto() checks as
    // app/api/ai/playwright/route.ts and batch-runner.ts — cross-check rather than
    // reject, so a drifted name doesn't throw away an otherwise-runnable heal.
    const expectedRoster = groupElementMapByPage(input.element_map);
    const expectedNames = new Set(expectedRoster.map((g) => g.class_name));
    const actualNames = new Set(parsed.data.page_objects.map((po) => po.class_name));
    const rosterWarnings: string[] = [];
    if (expectedRoster.length > 0 && parsed.data.page_objects.length === 0) {
      rosterWarnings.push('AI không trả về Page Object nào dù element map có dữ liệu.');
    }
    for (const name of expectedNames) {
      if (!actualNames.has(name)) rosterWarnings.push(`Thiếu Page Object dự kiến "${name}".`);
    }
    const allGeneratedSource = [parsed.data.code, ...parsed.data.page_objects.map((po) => po.code)].join('\n');
    if (!/\.goto\s*\(/.test(allGeneratedSource)) {
      rosterWarnings.push('Không tìm thấy lệnh page.goto(...) nào trong code đã heal.');
    }

    // Same defense-in-depth SELECTOR ATTRIBUTION check as app/api/ai/playwright/route.ts
    // - see checkSelectorAttribution() in playwright-agent.ts. Arguably MORE important
    // here than on a first-time generation: a heal pass is specifically prone to
    // "adapting" a nearby real selector to patch a failure instead of admitting the
    // target element still isn't grounded.
    rosterWarnings.push(...checkSelectorAttribution(parsed.data.page_objects, input.element_map));

    // Provenance marker so Code Viewer's warnings list makes it visible this version
    // came from a heal pass, not a plain Generate — no schema/DB migration needed,
    // "warnings" is already the established human-readable channel for this kind of note.
    const healNote = `[Heal] Regenerated to fix a failed run: ${input.failure.error_message}`;
    parsed.data.warnings = [healNote, ...rosterWarnings, ...parsed.data.warnings];

    // 4) Save as a new automation_scripts version — identical persistence shape to
    // app/api/ai/playwright/route.ts, always 'pending_review' (Review Gate applies
    // to a healed script exactly like a freshly generated one).
    const { data: existingVersion } = await supabase
      .from('automation_scripts')
      .select('version')
      .eq('test_case_id', input.test_case_id)
      .is('deleted_at', null)
      .order('version', { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (existingVersion?.version ?? 0) + 1;

    const { data: saved, error: saveError } = await supabase
      .from('automation_scripts')
      .insert({
        test_case_id: input.test_case_id,
        version: nextVersion,
        page_objects: parsed.data.page_objects,
        code: parsed.data.code,
        imports_used: parsed.data.imports_used,
        selectors_used: parsed.data.selectors_used,
        warnings: parsed.data.warnings,
        environment: input.environment,
        element_map: input.element_map,
        model_used: process.env.AI_MODEL_PLAYWRIGHT_HEAL ?? process.env.AI_MODEL_PLAYWRIGHT_CODEGEN ?? null,
        generated_by: user.id,
      })
      .select('id')
      .single();

    if (saveError || !saved) {
      console.error('[ai/playwright/heal] Lỗi lưu automation_scripts:', saveError?.message);
      return NextResponse.json({ success: false, error: saveError?.message ?? 'Không thể lưu script đã heal.' }, { status: 500 });
    }

    if (isR2Configured()) {
      uploadScriptToR2(input.test_case_id, saved.id, parsed.data.code).catch((err) => {
        console.warn('[ai/playwright/heal] R2 script mirror failed (non-fatal):', err);
      });
    }

    // Badge resets to "generated" like a normal Generate — the healed code hasn't
    // been run yet, so any previous passed/failed badge no longer reflects it.
    await supabase.from('test_cases').update({ automation_status: 'generated' }).eq('id', input.test_case_id);

    return NextResponse.json({
      success: true,
      data: { ...parsed.data, script_id: saved.id, status: 'pending_review' },
    });
  } catch (error: unknown) {
    console.error('❌ Lỗi API Playwright Heal:', error);

    if (error instanceof ZodError) {
      const errorMessage =
        'Dữ liệu đầu vào không hợp lệ: ' + error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      return NextResponse.json({ success: false, error: errorMessage, details: error.issues }, { status: 400 });
    }

    const failureMessage = error instanceof Error ? error.message : 'Có lỗi không xác định xảy ra khi heal Playwright code';
    return NextResponse.json({ success: false, error: failureMessage }, { status: 500 });
  }
}
