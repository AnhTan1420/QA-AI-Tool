import { NextResponse } from 'next/server';
// 1. Sửa import: Gọi hàm runAIAgent mới tạo
import { runAIAgent } from '@/lib/ai/provider';
import { buildReviewPrompt } from '@/lib/ai/prompts/review-agent';
import { reviewRequestSchema } from '@/lib/validators/test-case';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    // Validate dữ liệu từ client
    const payload = reviewRequestSchema.parse(await request.json());
    
    // 2. Tạo câu prompt để review
    const fullPrompt = buildReviewPrompt(payload);

    // 3. Gọi Agent AI (tự động chạy Gemini -> lỗi -> nhảy sang Groq)
    const review = await runAIAgent(fullPrompt);

    // 4. Trả kết quả JSON về cho frontend
    return NextResponse.json(review);
  } catch (error) {
    console.error("❌ Lỗi API Review:", error);
    const message = error instanceof Error ? error.message : 'Unable to review test cases';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}