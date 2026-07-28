import { NextResponse } from 'next/server';
import { runAIAgent } from '@/lib/ai/provider';
import { buildGenerationPrompt } from '@/lib/ai/prompts/generation-agent';

export const maxDuration = 60;
export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const promptString = buildGenerationPrompt({
      requirement_description: body.description,
      retrieved_old_test_cases: body.retrieved_old_test_cases ?? [],
      selected_categories: body.selected_categories ?? ["UI", "Functional"],
      language: body.language ?? "Vietnamese",
      detail_level: body.detail_level ?? "High"
    });

    const aiResult = await runAIAgent(promptString);

    // 🛡️ Nếu AI trả về mảng hoặc object trống, ép trả về mảng rỗng [] hoặc object an toàn
    return NextResponse.json(aiResult ?? []);
  } catch (error: any) {
    console.error("❌ Lỗi API Generate Test Cases:", error);
    return NextResponse.json(
      { error: error.message || "Có lỗi xảy ra khi tạo test case", testCases: [] },
      { status: 500 }
    );
  }
}