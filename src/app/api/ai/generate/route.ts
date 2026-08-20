import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { runAIAgent } from '@/services/ai/provider';
import { buildGenerationPrompt } from '@/services/ai/prompts/generation-agent';
import { buildGenerationResponseSchema } from '@/services/ai/prompts/generation-response-schema';
import {
  generateRequestSchema,
  generatedTestCasesSchema,
  generationAnalysisSchema,
} from '@/models/validators/test-case';
import { unwrapArrayResponse } from '@/services/ai/parse';
import { computeDocumentCoverage } from '@/services/documents/coverage';

// Cho phép Vercel Function chạy tối đa 5 phút (Vercel Pro)
export const maxDuration = 300;
export const runtime = 'nodejs';

/**
 * Generation Agent - Sinh bộ test case từ requirement description (+ RAG context / Document Atoms nếu có).
 * BẮT BUỘC: Validate cả input từ client lẫn output từ AI bằng Zod.
 */
export async function POST(req: Request) {
  try {
    const rawBody = await req.json();

    // 1) Validate INPUT từ client trước khi xử lý
    const input = generateRequestSchema.parse(rawBody);

    // Build prompt chuẩn 10/10 (7 layers analysis + JSON contract)
    const promptString = buildGenerationPrompt({
      requirement_description: input.requirement_description,
      retrieved_old_test_cases: input.retrieved_old_test_cases,
      selected_categories: input.selected_categories,
      language: input.language,
      detail_level: input.detail_level,
      document_context: input.document_context,
    });

    // Gọi AI Provider (Gemini / Groq Fallback) với Structured Output Schema
    const aiRawResult = await runAIAgent(
      promptString,
      'generation',
      buildGenerationResponseSchema()
    );

    // 2) Bọc lớp phòng thủ bóc tách JSON Object / String từ AI Response
    let rawJsonObject: Record<string, unknown> | null = null;

    if (typeof aiRawResult === 'string') {
      try {
        // Làm sạch Markdown code blocks (```json ... ```) nếu AI fallback trả về dạng string
        const cleaned = aiRawResult
          .replace(/```json\n?/gi, '')
          .replace(/```\n?/g, '')
          .trim();
        rawJsonObject = JSON.parse(cleaned);
      } catch {
        rawJsonObject = null;
      }
    } else if (aiRawResult && typeof aiRawResult === 'object') {
      rawJsonObject = aiRawResult as Record<string, unknown>;
    }

    // 3) Extract & Validate mảng `test_cases`
    // unwrapArrayResponse sẽ tự bóc mảng từ key "test_cases", "data", hoặc chính mảng đó
    const candidateTestCases = unwrapArrayResponse(rawJsonObject ?? aiRawResult);
    const parsedTestCases = generatedTestCasesSchema.safeParse(candidateTestCases);

    if (!parsedTestCases.success) {
      const flattenedIssues = parsedTestCases.error.issues.map(
        (issue: { path: (string | number)[]; message: string }) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })
      );

      console.error('[ai/generate] AI trả về JSON sai schema test case:', flattenedIssues);
      console.error(
        '[ai/generate] Raw AI result sample:',
        JSON.stringify(aiRawResult)?.slice(0, 3000)
      );

      return NextResponse.json(
        {
          success: false,
          error: 'AI trả về dữ liệu không đúng định dạng test case. Vui lòng thử lại.',
          details: flattenedIssues,
        },
        { status: 502 }
      );
    }

    // 4) Đối chiếu atom từ document_context với source_requirement_ids vừa sinh
    const documentCoverage = computeDocumentCoverage(
      input.document_context,
      parsedTestCases.data
    );

    // 5) Extract & Parse "analysis" (PHASE 0 - Deep Thinking)
    // Parse theo kiểu Lenient (safeParse): Nếu không hợp lệ thì trả về null chứ KHÔNG làm fail cả request
    const rawAnalysis = rawJsonObject?.analysis;
    const parsedAnalysis = generationAnalysisSchema.safeParse(rawAnalysis);

    if (!parsedAnalysis.success && rawAnalysis) {
      console.warn(
        '[ai/generate] "analysis" không hợp lệ/thiếu - bỏ qua, giữ nguyên test_cases:',
        parsedAnalysis.error.flatten()
      );
    }

    const analysis = parsedAnalysis.success ? parsedAnalysis.data : null;

    // 6) Trả về kết quả thành công cho Client
    return NextResponse.json({
      success: true,
      data: {
        test_cases: parsedTestCases.data,
        document_coverage: documentCoverage,
        analysis,
      },
    });
  } catch (error: unknown) {
    console.error('❌ Lỗi API Generate Test Cases:', error);

    // Phân loại lỗi Zod Input Validation (400) vs Lỗi Hệ thống/AI Runtime (500)
    if (error instanceof ZodError) {
      const errorMessage =
        'Dữ liệu đầu vào không hợp lệ: ' +
        error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');

      return NextResponse.json(
        { success: false, error: errorMessage, details: error.issues },
        { status: 400 }
      );
    }

    const failureMessage =
      error instanceof Error ? error.message : 'Có lỗi không xác định xảy ra khi tạo test case';

    return NextResponse.json(
      {
        success: false,
        error: failureMessage,
      },
      { status: 500 }
    );
  }
}