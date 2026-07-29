import { NextResponse } from 'next/server';
import { runAIAgent } from '@/lib/ai/provider';
import { buildReviewPrompt } from '@/lib/ai/prompts/review-agent';
import { buildEnhancePrompt } from '@/lib/ai/prompts/enhance-agent';
import { reviewResultSchema, generatedTestCasesSchema } from '@/lib/validators/test-case';
import { z } from 'zod';

export const maxDuration = 60;
export const runtime = 'nodejs';

const requestSchema = z.object({
  mode: z.enum(['review', 'enhance']),
  requirement_description: z.string().min(20),
  test_cases: z.array(z.any()).min(1),
  review_result: z.object({
    coverage_score: z.number().min(0).max(100),
    requirement_gaps: z.array(z.any()),
    test_case_comments: z.array(z.any()),
  }).optional(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = requestSchema.parse(body);
    const { mode, requirement_description, test_cases } = payload;

    // Build prompt theo mode
    let fullPrompt: string;
    if (mode === 'review') {
      fullPrompt = buildReviewPrompt({
        requirement_description,
        generated_test_cases: test_cases,
      });
    } else {
      if (!payload.review_result) {
        return NextResponse.json(
          { success: false, error: 'Enhance mode cần truyền review_result' },
          { status: 400 }
        );
      }
      fullPrompt = buildEnhancePrompt({
        requirement_description,
        test_cases,
        review_result: payload.review_result,
      });
    }

    // Gọi AI
    let aiRawResult: unknown;
    try {
      aiRawResult = await runAIAgent(fullPrompt, 'review');
    } catch (aiError) {
      console.error(`[ai/${mode}] AI provider error:`, aiError);
      return NextResponse.json(
        { success: false, error: 'AI đang quá tải. Vui lòng thử lại sau 1 phút.' },
        { status: 502 }
      );
    }

    // Xử lý nếu AI trả string (wrap trong markdown)
    if (typeof aiRawResult === 'string') {
      try {
        aiRawResult = JSON.parse(aiRawResult);
      } catch {
        return NextResponse.json(
          { success: false, error: 'AI trả về định dạng không hợp lệ' },
          { status: 502 }
        );
      }
    }

    // Validate output theo mode
    if (mode === 'review') {
      const parsed = reviewResultSchema.safeParse(aiRawResult);
      if (!parsed.success) {
        console.error('[ai/review] Schema fail:', parsed.error.flatten());
        return NextResponse.json(
          { success: false, error: 'AI trả review không đúng định dạng. Thử lại.' },
          { status: 502 }
        );
      }
      return NextResponse.json({ success: true, data: parsed.data });
    } else {
      const parsed = generatedTestCasesSchema.safeParse(aiRawResult);
      if (!parsed.success) {
        console.error('[ai/enhance] Schema fail:', parsed.error.flatten());
        return NextResponse.json(
          { success: false, error: 'AI trả enhance không đúng định dạng. Thử lại.' },
          { status: 502 }
        );
      }
      return NextResponse.json({ success: true, data: parsed.data });
    }
  } catch (error) {
    console.error('❌ Lỗi API AI:', error);
    const message = error instanceof Error ? error.message : 'Lỗi không xác định';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}