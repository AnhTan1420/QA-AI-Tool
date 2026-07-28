import { GoogleGenAI } from "@google/genai";
import { generateWithGemini } from "./gemini";
import { generateWithGroq } from "./groq";

// ─────────────────────────────────────────────────────────────
// 1. MAIN FUNCTION: TEXT GENERATION & FALLBACK
// Tự động gọi AI tạo test case/review (Gemini -> lỗi -> Groq)
// ─────────────────────────────────────────────────────────────
export async function runAIAgent(fullPrompt: string) {
  // Thiết lập system prompt chung để ép AI tuân thủ form JSON
  const systemPrompt = "You are a professional QA Assistant. Return ONLY valid JSON format.";

  try {
    // Ưu tiên 1: Chạy mạng lưới Gemini
    return await generateWithGemini(systemPrompt, fullPrompt);
  } catch (geminiError) {
    console.warn("⚠️ [Provider] Mạng lưới Gemini đã hết Quota/Rate Limit. Đang chuyển qua Groq...");

    try {
      // Ưu tiên 2: Fallback sang mạng lưới Groq
      return await generateWithGroq(systemPrompt, fullPrompt);
    } catch (groqError) {
      console.error("❌ [Provider] Tất cả AI Model đều thất bại!");
      throw new Error(
        "Hệ thống AI hiện đang quá tải (Vượt quá Rate Limit của cả Gemini lẫn Groq). Vui lòng đợi khoảng 1 phút rồi thử lại."
      );
    }
  }
}

// ─────────────────────────────────────────────────────────────
// 2. MAIN FUNCTION: TẠO VECTOR EMBEDDING
// Chuyên dùng để nhúng text thành vector số học bằng Gemini
// ─────────────────────────────────────────────────────────────
export async function createEmbedding(content: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY });
  
  try {
    const response = await ai.models.embedContent({
      model: process.env.AI_MODEL_EMBEDDING ?? 'text-embedding-004',
      contents: content,
    });
    
    // Kiểm tra và trả về trực tiếp mảng số thực (vector array)
    if (!response.embeddings || response.embeddings.length === 0) {
      throw new Error("Không nhận được dữ liệu embedding từ Gemini");
    }
    
    return response.embeddings[0].values; 
  } catch (error) {
    console.error("❌ Lỗi tạo Embedding:", error);
    throw error;
  }
}