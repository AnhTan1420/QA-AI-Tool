import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { runAIAgent } from '@/lib/ai/provider';
import { buildPlaywrightCodegenPrompt } from '@/lib/ai/prompts/playwright-agent';
import { buildPlaywrightResponseSchema } from '@/lib/ai/prompts/playwright-response-schema';
import { playwrightCodegenRequestSchema, playwrightScriptSchema } from '@/lib/validators/playwright';
import { createClient } from '@/lib/supabase/server';

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
        .order('version', { ascending: false })
        .limit(1)
        .maybeSingle();

      const nextVersion = (existing?.version ?? 0) + 1;

      const { data: saved, error: saveError } = await supabase
        .from('automation_scripts')
        .insert({
          test_case_id: testCaseId,
          version: nextVersion,
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
        // Badge trạng thái ở library list (test-cases table) - "generated" trừ khi
        // đã có kết quả pass/fail trước đó (không hạ cấp trạng thái khi generate lại).
        await supabase
          .from('test_cases')
          .update({ automation_status: 'generated' })
          .eq('id', testCaseId)
          .eq('automation_status', 'not_generated');
      }
    }

    return NextResponse.json({
      success: true,
      data: { ...parsed.data, script_id: savedScriptId },
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
