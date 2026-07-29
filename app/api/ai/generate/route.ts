import { NextResponse } from 'next/server';
import { runAIAgent } from '@/lib/ai/provider';
import { buildGenerationPrompt } from '@/lib/ai/prompts/generation-agent';
import { generateRequestSchema, generatedTestCasesSchema } from '@/lib/validators/test-case';

export const maxDuration = 60;
export const runtime = 'nodejs';

/**
 * Generation Agent - sinh bo test case tu requirement description (+ RAG context neu co).
 * BAT BUOC: validate ca input tu client lan output tu AI bang Zod (spec muc V.5 / XI) -
 * khong tin bat ky JSON nao chua qua validate.
 */
export async function POST(req: Request) {
  try {
    const rawBody = await req.json();
    // 1) Validate INPUT tu client truoc khi lam bat cu viec gi.
    const input = generateRequestSchema.parse(rawBody);

    const promptString = buildGenerationPrompt({
      requirement_description: input.requirement_description,
      retrieved_old_test_cases: input.retrieved_old_test_cases,
      selected_categories: input.selected_categories,
      language: input.language,
      detail_level: input.detail_level,
    });

    const aiRawResult = await runAIAgent(promptString, 'generation');

    // 2) Validate OUTPUT tu AI truoc khi tra ve client - KHONG bao gio tin JSON tho tu LLM,
    // du da ep responseMimeType: application/json o phia provider.
    const parsedTestCases = generatedTestCasesSchema.safeParse(aiRawResult);
    if (!parsedTestCases.success) {
      console.error('[ai/generate] AI tra ve JSON sai schema:', parsedTestCases.error.flatten());
      return NextResponse.json(
        {
          success: false,
          error: 'AI tra ve du lieu khong dung dinh dang test case. Vui long thu lai.',
        },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, data: parsedTestCases.data });
  } catch (error: any) {
    console.error('❌ Lỗi API Generate Test Cases:', error);
    const message =
      error?.issues // loi tu Zod parse input
        ? 'Dữ liệu đầu vào không hợp lệ: ' + error.issues.map((i: any) => i.message).join(', ')
        : error?.message || 'Có lỗi xảy ra khi tạo test case';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
