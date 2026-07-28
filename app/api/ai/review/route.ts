import { NextResponse } from 'next/server';
import { getAiProvider } from '@/lib/ai/provider';
import { buildReviewPrompt } from '@/lib/ai/prompts/review-agent';
import { reviewRequestSchema } from '@/lib/validators/test-case';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const payload = reviewRequestSchema.parse(await request.json());
    const provider = await getAiProvider();
    const review = await provider.reviewTestCases({
      model: process.env.AI_MODEL_REVIEW ?? process.env.AI_MODEL_GENERATION ?? 'gemini-2.0-flash',
      prompt: buildReviewPrompt(payload),
    });

    return NextResponse.json(review);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to review test cases';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
