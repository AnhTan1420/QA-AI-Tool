import { GoogleGenAI } from "@google/genai";
import { generateWithGemini } from "./gemini";
import { generateWithGroq } from "./groq";

export type AITask = 'generation' | 'review' | 'classification';

/**
 * Model routing theo tác vụ (mục II của spec):
 * - generation / review: model mạnh nhất (AI_MODEL_GENERATION / AI_MODEL_REVIEW)
 * - classification: model nhẹ/rẻ hơn (AI_MODEL_CLASSIFICATION)
 * Mỗi biến đều đọc từ .env - không hard-code model ID trong code.
 * 
 * Lưu ý: maxOutputTokens được cấu hình cố định ở từng provider:
 *   - Gemini: 4096 tokens (lib/ai/gemini.ts)
 *   - Groq: 3500 tokens   (lib/ai/groq.ts)
 */
function getGeminiModelsForTask(task: AITask): string[] {
  const primaryByTask: Record<AITask, string | undefined> = {
    generation: process.env.AI_MODEL_GENERATION,
    review: process.env.AI_MODEL_REVIEW,
    classification: process.env.AI_MODEL_CLASSIFICATION,
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