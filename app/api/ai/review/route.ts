import { NextResponse } from 'next/server';
import { runAIAgent } from '@/lib/ai/provider';
import { buildReviewPrompt } from '@/lib/ai/prompts/review-agent';
import { reviewRequestSchema } from '@/lib/validators/test-case';

export const maxDuration = 60; // Chống timeout trên Vercel
export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const payload = reviewRequestSchema.parse(body);
    
    // Tạo prompt review
    const fullPrompt = buildReviewPrompt(payload);

    // Gọi AI (Tự động fallback Gemini -> Groq nếu lỗi)
    const reviewResult = await runAIAgent(fullPrompt);

    // 🛡️ AN TOÀN TUYỆT ĐỐI: Đảm bảo luôn trả về một object hợp lệ, không bao giờ null/undefined
    return NextResponse.json(reviewResult ?? {});
  } catch (error) {
    console.error("❌ Lỗi API Review:", error);
    const message = error instanceof Error ? error.message : 'Unable to review test cases';
    
    // Trả về định dạng JSON an toàn kèm cờ báo lỗi để frontend dễ xử lý
    return NextResponse.json(
      { error: message, success: false, generated_test_cases: [], gaps: [] }, 
      { status: 400 }
    );
  }
}