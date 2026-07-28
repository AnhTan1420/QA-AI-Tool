import { NextResponse } from "next/server";
// 1. Import hàm tạo prompt từ folder prompts của bạn
import { buildGenerationPrompt } from "@/lib/ai/prompts/generation-agent"; 
// 2. Import hàm runAIAgent từ provider.ts (sửa lại đường dẫn cho đúng vị trí file provider.ts của bạn)
import { runAIAgent } from "@/lib/ai/provider"; // hoặc "@/lib/ai/provider" nếu bạn để trong folder lib

export const maxDuration = 60;
export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Lấy dữ liệu người dùng truyền lên từ frontend
    const { 
      description, 
      retrieved_old_test_cases = [], 
      selected_categories = ["UI", "Functional"], 
      language = "Vietnamese", 
      detail_level = "High" 
    } = body;

    // 1. Dùng hàm buildGenerationPrompt để tạo câu prompt đầy đủ
    const promptString = buildGenerationPrompt({
      requirement_description: description,
      retrieved_old_test_cases,
      selected_categories,
      language,
      detail_level,
    });

    // 2. Tự động gọi Gemini -> nếu hết Quota thì tự chuyển qua Groq
    const aiResult = await runAIAgent(promptString);

    // 3. Trả kết quả về cho Client/Frontend
    return NextResponse.json(aiResult);
  } catch (error: any) {
    console.error("❌ API Error:", error);
    return NextResponse.json(
      { error: error.message || "Có lỗi xảy ra khi tạo test case" },
      { status: 500 }
    );
  }
}