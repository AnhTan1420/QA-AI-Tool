import { GoogleGenAI } from "@google/genai";
import { generateWithGemini } from "./gemini";
import { generateWithGroq } from "./groq";

export type AITask = 'generation' | 'review' | 'classification';

/**
 * Model routing theo tac vu (muc II cua spec):
 * - generation / review: model manh nhat (AI_MODEL_GENERATION / AI_MODEL_REVIEW)
 * - classification: model nhe/re hon (AI_MODEL_CLASSIFICATION)
 * Moi bien deu doc tu .env - khong hard-code model ID trong code.
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
      `Thieu bien moi truong model cho tac vu "${task}" (vi du AI_MODEL_${task.toUpperCase()}).`
    );
  }
  return models;
}

function getGroqModelsForTask(): string[] {
  // Groq chi dung nhu fallback toc do cao khi Gemini loi - dung chung 1 cap model
  // cho moi tac vu, khai bao qua GROQ_MODEL_PRIMARY / GROQ_MODEL_FALLBACK.
  return [process.env.GROQ_MODEL_PRIMARY, process.env.GROQ_MODEL_FALLBACK].filter(
    (m): m is string => Boolean(m)
  );
}

/**
 * Goi AI sinh JSON theo tac vu (Gemini truoc, fallback Groq khi Gemini loi ha tang/rate-limit).
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
 * Tao vector embedding (RAG) bang Gemini Embedding API.
 */
export async function createEmbedding(content: string) {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Thieu GOOGLE_GEMINI_API_KEY trong bien moi truong server.');
  }
  const embeddingModel = process.env.AI_MODEL_EMBEDDING;
  if (!embeddingModel) {
    throw new Error('Thieu bien moi truong AI_MODEL_EMBEDDING.');
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
