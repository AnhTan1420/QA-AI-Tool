import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { runAIAgent } from '@/services/ai/provider';
import { buildPlaywrightCodegenPrompt, groupElementMapByPage } from '@/services/ai/prompts/playwright-agent';
import { buildPlaywrightResponseSchema } from '@/services/ai/prompts/playwright-response-schema';
import { playwrightCodegenRequestSchema, playwrightScriptSchema } from '@/models/validators/playwright';
import { createClient } from '@/services/supabase/server';
import { uploadScriptToR2, isR2Configured } from '@/services/automation/r2-storage';

// Chạy browser (inspect/run) diễn ra ở /api/automation/*, không phải ở đây -
// route này CHỈ gọi LLM để sinh code, giữ đúng nguyên tắc mỗi route 1 trách nhiệm.
export const maxDuration = 120;
export const runtime = 'nodejs';

/**
 * Playwright Codegen Agent - sinh Playwright TypeScript test source từ 1 test case
 * (title/preconditions/steps/expected_result) + DOM/element map thật (đã inspect
 * qua /api/automation/inspect) để tránh AI "ảo giác" selector không tồn tại.
 *
 * Luồng đầy đủ: xem app/(dashboard)/.../test-cases/[caseId]/page.tsx (tab "Automation")
 * 1) User cấu hình environment + bấm Inspect -> /api/automation/inspect
 * 2) User bấm "Generate Playwright Code" -> route này
 * 3) Kết quả (đã Zod-validate) được lưu thành 1 bản ghi automation_scripts (version mới)
 *    gắn với test_case_id - KHÔNG bao giờ ghi đè bản cũ, cùng tinh thần với test_case_versions.
 *    Bản ghi mới luôn ở status='pending_review' ("Review Gate") - nút Run trong UI sẽ
 *    không chạy được cho tới khi user "Approve & Run" hoặc "Edit / Tweak" (tự động approve).
 */
export async function POST(req: Request) {
  try {
    const rawBody = await req.json();

    // 1) Validate INPUT
    const input = playwrightCodegenRequestSchema.parse(rawBody);

    // 2) Build prompt + gọi AI Provider (Gemini -> AI_MODEL_FALLBACK -> Groq)
    const promptString = buildPlaywrightCodegenPrompt(input);
    const aiRawResult = await runAIAgent(promptString, 'playwright_codegen', buildPlaywrightResponseSchema());

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

    // 3) Zod-validate OUTPUT trước khi trả về/lưu DB - KHÔNG BAO GIỜ tin JSON thô từ AI
    const parsed = playwrightScriptSchema.safeParse(rawJsonObject);
    if (!parsed.success) {
      console.error('[ai/playwright] AI trả về JSON sai schema:', parsed.error.issues);
      return NextResponse.json(
        {
          success: false,
          error: 'AI trả về dữ liệu không đúng định dạng Playwright script. Vui lòng thử lại.',
          details: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
        { status: 502 },
      );
    }

    // 3b) Defense-in-depth Page Object identity check (never trust raw AI JSON, applied
    // to IDENTITY not just shape): class_name/file_name are DETERMINISTIC, derived from
    // the element map in buildPlaywrightCodegenPrompt - the prompt hands the model the
    // exact roster to copy, but the model can still drift. Cross-check rather than
    // reject outright (a drifted name is still runnable, just not what the roster
    // promised), so a near-miss doesn't throw away an otherwise-good generation.
    const expectedRoster = groupElementMapByPage(input.element_map);
    const expectedNames = new Set(expectedRoster.map((g) => g.class_name));
    const actualNames = new Set(parsed.data.page_objects.map((po) => po.class_name));
    const rosterWarnings: string[] = [];
    if (expectedRoster.length > 0 && parsed.data.page_objects.length === 0) {
      rosterWarnings.push(
        'AI không trả về Page Object nào dù element map có dữ liệu - code sinh ra có thể không theo kiến trúc POM như mong đợi, kiểm tra lại trước khi dùng.',
      );
    }
    for (const name of expectedNames) {
      if (!actualNames.has(name)) {
        rosterWarnings.push(`Thiếu Page Object dự kiến "${name}" (đã tính từ element map) trong kết quả AI trả về.`);
      }
    }

    // 3c) Defense-in-depth NAVIGATION check: the prompt instructs the model to make the
    // spec's FIRST action a Page Object goto() method that internally calls
    // `this.page.goto(target_url)` - but nothing here enforced it actually happened. The
    // in-app Run button no longer depends on this (lib/automation/browser-runner.ts's
    // runGeneratedScript now always navigates itself before the test body runs, as a
    // safety net), but the SAME code/page_objects are also meant to be exported as real
    // files and run via `npx playwright test` in the user's own suite, where that safety
    // net doesn't exist - so still flag it here rather than silently trusting the model.
    const allGeneratedSource = [parsed.data.code, ...parsed.data.page_objects.map((po) => po.code)].join('\n');
    if (!/\.goto\s*\(/.test(allGeneratedSource)) {
      rosterWarnings.push(
        'Không tìm thấy lệnh page.goto(...) nào trong code sinh ra - nếu export ra file thật và chạy bằng `npx playwright test`, test có thể fail ngay từ đầu vì trang chưa được điều hướng tới target URL. (Nút Run trong app vẫn hoạt động bình thường vì runner tự động điều hướng trước khi chạy.)',
      );
    }

    if (rosterWarnings.length > 0) {
      parsed.data.warnings = [...parsed.data.warnings, ...rosterWarnings];
    }

    // 4) (Best-effort) tìm test_case_id nếu client gửi kèm, để tự lưu version luôn -
    // giữ optional để route này vẫn dùng được độc lập (VD preview trước khi có test case đã lưu).
    const testCaseId = typeof rawBody?.test_case_id === 'string' ? rawBody.test_case_id : null;
    let savedScriptId: string | null = null;

    if (testCaseId) {
      const supabase = await createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const { data: existing } = await supabase
        .from('automation_scripts')
        .select('version')
        .eq('test_case_id', testCaseId)
        // Excludes soft-deleted rows (deleted_at) so the version number stays
        // consistent with app/api/test-cases/[id]/automation/scripts/route.ts,
        // which also filters deleted_at when computing the next version.
        .is('deleted_at', null)
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextVersion = (existing?.version ?? 0) + 1;

      const { data: saved, error: saveError } = await supabase
        .from('automation_scripts')
        .insert({
          test_case_id: testCaseId,
          version: nextVersion,
          page_objects: parsed.data.page_objects,
          code: parsed.data.code,
          imports_used: parsed.data.imports_used,
          selectors_used: parsed.data.selectors_used,
          warnings: parsed.data.warnings,
          environment: input.environment,
          element_map: input.element_map,
          model_used: process.env.AI_MODEL_PLAYWRIGHT_CODEGEN ?? null,
          generated_by: user?.id ?? null,
        })
        .select('id')
        .single();

      if (saveError) {
        console.error('[ai/playwright] Lỗi lưu automation_scripts:', saveError.message);
      } else {
        savedScriptId = saved.id;

        // Optional: mirror the script text to Cloudflare R2 for durable, portable
        // storage alongside screenshots (see CLOUDFLARE_R2_SETUP.md). This is
        // best-effort and never blocks the response - automation_scripts.code in
        // Postgres remains the source of truth the app reads from.
        if (isR2Configured()) {
          uploadScriptToR2(testCaseId, saved.id, parsed.data.code).catch((err) => {
            console.warn('[ai/playwright] R2 script mirror failed (non-fatal):', err);
          });
        }

        // Badge trạng thái ở library list (test-cases table). Mỗi lần generate/
        // regenerate MOI đều set lại về "generated" - kể cả khi trước đó đã có
        // pass/fail - vì code vừa sinh ra CHƯA được chạy lại, nên badge "passed"/
        // "failed" cũ không còn phản ánh đúng code hiện tại (fix Section 6 audit:
        // trước đây filter .eq('automation_status', 'not_generated') khiến badge
        // bị kẹt ở "passed"/"failed" cũ dù code đã đổi hoàn toàn).
        await supabase
          .from('test_cases')
          .update({ automation_status: 'generated' })
          .eq('id', testCaseId);
      }
    }

    return NextResponse.json({
      success: true,
      data: { ...parsed.data, script_id: savedScriptId, status: 'pending_review' },
    });
  } catch (error: unknown) {
    console.error('❌ Lỗi API Playwright Codegen:', error);

    if (error instanceof ZodError) {
      const errorMessage =
        'Dữ liệu đầu vào không hợp lệ: ' + error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      return NextResponse.json({ success: false, error: errorMessage, details: error.issues }, { status: 400 });
    }

    const failureMessage = error instanceof Error ? error.message : 'Có lỗi không xác định xảy ra khi sinh Playwright code';
    return NextResponse.json({ success: false, error: failureMessage }, { status: 500 });
  }
}
