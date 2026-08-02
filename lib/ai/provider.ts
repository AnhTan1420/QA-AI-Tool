import { GoogleGenAI } from "@google/genai";
import { generateWithGemini } from "./gemini";
import { generateWithGroq } from "./groq";
import { generateWithGeminiVision, type VisionImageInput } from "./vision";

export type { VisionImageInput };
export type AITask = 'generation' | 'review' | 'classification' | 'document_extraction';

/**
 * Model routing theo tác vụ (mục II của spec):
 * - generation / review: model mạnh nhất (AI_MODEL_GENERATION / AI_MODEL_REVIEW)
 * - classification: model nhẹ/rẻ hơn (AI_MODEL_CLASSIFICATION)
 * - document_extraction: model đọc/atomize tài liệu (Figma/Markdown/FS/logic-doc/
 *   PDF/DOCX + ảnh ERD/diagram/UI mockup) cho AI Document Reader — dùng
 *   AI_MODEL_DOCUMENT_EXTRACTION, PHẢI là model Gemini hỗ trợ multimodal (đa số
 *   dòng Gemini flash đều hỗ trợ) vì nhánh ảnh (runDocumentVisionAgent) tái sử
 *   dụng cùng danh sách model này.
 * Mỗi biến đều đọc từ .env - không hard-code model ID trong code.
 * 
 * Lưu ý: maxOutputTokens được cấu hình cố định ở từng provider:
 *   - Gemini: 8192 tokens (lib/ai/gemini.ts, lib/ai/vision.ts)
 *   - Groq: 8000 tokens   (lib/ai/groq.ts)
 * (Từng bị 4096/3500 - qua thấp, khien AI bi cat cut JSON giua chung khi document/
 * set test case co nhieu atom/case, gay loi "Expected ',' or ']' after array
 * element". Da tang len + them co che tu phuc hoi JSON bi cat trong lib/ai/parse.ts.)
 */
function getGeminiModelsForTask(task: AITask): string[] {
  const primaryByTask: Record<AITask, string | undefined> = {
    generation: process.env.AI_MODEL_GENERATION,
    review: process.env.AI_MODEL_REVIEW,
    classification: process.env.AI_MODEL_CLASSIFICATION,
    document_extraction: process.env.AI_MODEL_DOCUMENT_EXTRACTION,
  };
  const primary = primaryByTask[task];
  const fallback = process.env.AI_MODEL_FALLBACK;

  const models = [primary, fallback].filter((m): m is string => Boolean(m));
  if (models.length === 0) {
    throw new Error(
      `Thiếu biến môi trường model cho tác vụ "${task}" (ví dụ AI_MODEL_${task.toUpperCase()}).`
    );
  }
  return models;
}

function getGroqModelsForTask(): string[] {
  // Groq chỉ dùng như fallback tốc độ cao khi Gemini lỗi - dùng chung 1 cặp model
  // cho mọi tác vụ, khai báo qua GROQ_MODEL_PRIMARY / GROQ_MODEL_FALLBACK.
  return [process.env.GROQ_MODEL_PRIMARY, process.env.GROQ_MODEL_FALLBACK].filter(
    (m): m is string => Boolean(m)
  );
}

/**
 * Gọi AI sinh JSON theo tác vụ (Gemini trước, fallback Groq khi Gemini lỗi hạ tầng/rate-limit).
 */
export async function runAIAgent(fullPrompt: string, task: AITask = 'generation') {
  const systemPrompt = "You are a professional QA Assistant. Return ONLY valid JSON format.";

  try {
    return await generateWithGemini(systemPrompt, fullPrompt, getGeminiModelsForTask(task));
  } catch (geminiError) {
    console.warn("⚠️ [Provider] Gemini thất bại. Đang chuyển qua Groq...", geminiError);

    try {
      return await generateWithGroq(systemPrompt, fullPrompt, getGroqModelsForTask());
    } catch (groqError) {
      console.error("❌ [Provider] Tất cả AI Model đều thất bại!", groqError);
      throw new Error(
        "Hệ thống AI hiện đang quá tải (Vượt quá Rate Limit của cả Gemini lẫn Groq). Vui lòng đợi khoảng 1 phút rồi thử lại."
      );
    }
  }
}

/**
 * Gọi Gemini ở chế độ vision để đọc ảnh diagram/ERD/UI mockup cho AI Document
 * Reader (xem lib/documents/, lib/ai/prompts/document-extraction-agent.ts).
 * KHÔNG fallback sang Groq — groq-sdk trong project này chỉ được dùng cho text.
 */
export async function runDocumentVisionAgent(fullPrompt: string, images: VisionImageInput[]) {
  const systemPrompt = "You are a meticulous Document Vision Analyst for a QA test-case tool. Return ONLY valid JSON format.";

  try {
    return await generateWithGeminiVision(systemPrompt, fullPrompt, images, getGeminiModelsForTask('document_extraction'));
  } catch (error) {
    console.error("❌ [Provider] Gemini Vision thất bại (không có fallback Groq cho vision):", error);
    throw new Error(
      "Không thể phân tích ảnh/diagram lúc này (Gemini Vision lỗi hoặc quá tải). Vui lòng thử lại sau."
    );
  }
}

/**
 * Tạo vector embedding (RAG) bằng Gemini Embedding API.
 */
export async function createEmbedding(content: string) {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Thiếu GOOGLE_GEMINI_API_KEY trong biến môi trường server.');
  }
  const embeddingModel = process.env.AI_MODEL_EMBEDDING;
  if (!embeddingModel) {
    throw new Error('Thiếu biến môi trường AI_MODEL_EMBEDDING.');
  }

  const ai = new GoogleGenAI({ apiKey });

  try {
    const response = await ai.models.embedContent({
      model: embeddingModel,
      contents: content,
    });

    if (!response.embeddings || response.embeddings.length === 0) {
      throw new Error("Không nhận được dữ liệu embedding từ Gemini");
    }

    return response.embeddings[0].values;
  } catch (error) {
    console.error("❌ Lỗi tạo Embedding:", error);
    throw error;
  }
}