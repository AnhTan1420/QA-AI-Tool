import { NextResponse } from 'next/server';
import { runAIAgent } from '@/lib/ai/provider';
import { buildReviewPrompt } from '@/lib/ai/prompts/review-agent';
import { buildEnhancePrompt } from '@/lib/ai/prompts/enhance-agent';
import { reviewResultSchema, generatedTestCasesSchema } from '@/lib/validators/test-case';
import { z } from 'zod';

export const maxDuration = 120;
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

    let aiRawResult: unknown;
    try {
      aiRawResult = await runAIAgent(fullPrompt, 'review');
    } catch (aiError) {
      console.error(`[ai/${mode}] AI provider error:`, aiError);
      return NextResponse.json(
        { success: false, error: 'AI đang quá tải. Vui lòng thử lại sau.' },
        { status: 502 }
      );
    }

    // Xử lý nếu AI trả string
    if (typeof aiRawResult === 'string') {
      const rawString = aiRawResult;
      try {
        aiRawResult = JSON.parse(rawString);
      } catch {
        console.error(`[ai/${mode}] AI trả string không phải JSON:`, rawString.slice(0, 500));
        return NextResponse.json(
          { success: false, error: 'AI trả về định dạng không hợp lệ' },
          { status: 502 }
        );
      }
    }

    console.log(`[ai/${mode}] AI raw result type:`, typeof aiRawResult, Array.isArray(aiRawResult) ? '(array)' : '(not array)');

    // NẾU enhance: AI có thể trả { test_cases: [...] } thay vì [...]
    if (mode === 'enhance' && aiRawResult && typeof aiRawResult === 'object' && !Array.isArray(aiRawResult)) {
      const obj = aiRawResult as Record<string, unknown>;
      if (Array.isArray(obj.test_cases)) {
        console.log('[ai/enhance] Unwrapping obj.test_cases -> array');
        aiRawResult = obj.test_cases;
      } else if (Array.isArray(obj.data)) {
        console.log('[ai/enhance] Unwrapping obj.data -> array');
        aiRawResult = obj.data;
      }
    }

    console.log(`[ai/${mode}] AI raw result:`, JSON.stringify(aiRawResult, null, 2).slice(0, 2000));

    // Validate output
    if (mode === 'review') {
      const parsed = reviewResultSchema.safeParse(aiRawResult);
      if (!parsed.success) {
        console.error('[ai/review] Schema fail:', JSON.stringify(parsed.error.flatten(), null, 2));
        console.error('[ai/review] Raw data:', JSON.stringify(aiRawResult, null, 2));
        return NextResponse.json(
          { success: false, error: `AI trả review sai định dạng: ${parsed.error.errors[0]?.message || 'unknown'}` },
          { status: 502 }
        );
      }
      return NextResponse.json({ success: true, data: parsed.data });
    } else {
      const parsed = generatedTestCasesSchema.safeParse(aiRawResult);
      if (!parsed.success) {
        console.error('[ai/enhance] Schema fail:', JSON.stringify(parsed.error.flatten(), null, 2));
        console.error('[ai/enhance] Raw data:', JSON.stringify(aiRawResult, null, 2));
        return NextResponse.json(
          { success: false, error: `AI trả enhance sai định dạng: ${parsed.error.errors[0]?.message || 'unknown'}` },
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