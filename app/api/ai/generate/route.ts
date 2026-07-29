import { NextResponse } from 'next/server';
import { runAIAgent } from '@/lib/ai/provider';
import { buildGenerationPrompt } from '@/lib/ai/prompts/generation-agent';
import { generateRequestSchema, generatedTestCasesSchema } from '@/lib/validators/test-case';
import { unwrapArrayResponse } from '@/lib/ai/parse';

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
    // Luu y: khi fallback sang Groq, response_format "json_object" bat buoc AI phai
    // tra ve 1 JSON OBJECT o top-level (khong the la bare array) -> AI se tu bọc mang
    // test case vao 1 key nhu "test_cases"/"data"/... -> can go bo lop bọc nay truoc
    // khi validate, neu khong se bi bao sai "khong dung dinh dang test case" oan.
    const normalizedResult = unwrapArrayResponse(aiRawResult);
    const parsedTestCases = generatedTestCasesSchema.safeParse(normalizedResult);
    if (!parsedTestCases.success) {
      const flattenedIssues = parsedTestCases.error.issues.map((issue: { path: (string | number)[]; message: string }) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      console.error('[ai/generate] AI tra ve JSON sai schema:', flattenedIssues);
      console.error('[ai/generate] Raw AI result:', JSON.stringify(aiRawResult)?.slice(0, 3000));
      return NextResponse.json(
        {
          success: false,
          error: 'AI tra ve du lieu khong dung dinh dang test case. Vui long thu lai.',
          // Chi tiet loi tung field de debug ngay tren client, khong can vao Vercel logs.
          details: flattenedIssues,
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
