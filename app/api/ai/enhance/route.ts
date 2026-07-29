import { NextResponse } from 'next/server';
import { runAIAgent } from '@/lib/ai/provider';
import { buildEnhancePrompt } from '@/lib/ai/prompts/enhance-agent';
import { generatedTestCasesSchema } from '@/lib/validators/test-case';
import { z } from 'zod';

export const maxDuration = 60;
export const runtime = 'nodejs';

const enhanceRequestSchema = z.object({
  requirement_description: z.string().min(20),
  test_cases: generatedTestCasesSchema,
  review_result: z.object({
    coverage_score: z.number().min(0).max(100),
    requirement_gaps: z.array(z.object({
      requirement_text: z.string().min(1),
      suggested_test_case: z.any().optional(),
    })),
    test_case_comments: z.array(z.object({
      test_case_code: z.string().min(1),
      issue_type: z.enum(['missing_step', 'ambiguous_expected', 'duplicate', 'priority_mismatch']),
      comment: z.string().min(1),
    })),
  }),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = enhanceRequestSchema.parse(body);

    const fullPrompt = buildEnhancePrompt(payload);
    const aiRawResult = await runAIAgent(fullPrompt, 'review');

    const parsed = generatedTestCasesSchema.safeParse(aiRawResult);
    if (!parsed.success) {
      console.error('[ai/enhance] AI trả về JSON sai schema:', parsed.error.flatten());
      return NextResponse.json(
        { success: false, error: 'AI trả về dữ liệu enhance không đúng định dạng. Vui lòng thử lại.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, data: parsed.data });
  } catch (error) {
    console.error('❌ Lỗi API Enhance:', error);
    const message = error instanceof Error ? error.message : 'Unable to enhance test cases';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}