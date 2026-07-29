import { NextResponse } from 'next/server';
import { runAIAgent } from '@/lib/ai/provider';
import { buildReviewPrompt } from '@/lib/ai/prompts/review-agent';
import { reviewRequestSchema, reviewResultSchema } from '@/lib/validators/test-case';

export const maxDuration = 60; // Chống timeout trên Vercel
export const runtime = 'nodejs';

/**
 * Senior QA Review Agent - LOI GOI AI DOC LAP voi Generation Agent:
 * route rieng, khong chia se lich su hoi thoai, khong nhan test case cu tham khao,
 * chi nhan description goc + bo test case vua sinh.
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = reviewRequestSchema.parse(body);

    const fullPrompt = buildReviewPrompt(payload);

    // Gọi AI (tự động fallback Gemini -> Groq nếu lỗi)
    const aiRawResult = await runAIAgent(fullPrompt, 'review');

    // Validate OUTPUT truoc khi tra ve client - khong tin JSON tho tu LLM.
    const parsedReview = reviewResultSchema.safeParse(aiRawResult);
    if (!parsedReview.success) {
      console.error('[ai/review] AI tra ve JSON sai schema:', parsedReview.error.flatten());
      return NextResponse.json(
        { success: false, error: 'AI tra ve du lieu review khong dung dinh dang. Vui long thu lai.' },
        { status: 502 }
      );
    }

    return NextResponse.json({ success: true, data: parsedReview.data });
  } catch (error) {
    console.error('❌ Lỗi API Review:', error);
    const message = error instanceof Error ? error.message : 'Unable to review test cases';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
