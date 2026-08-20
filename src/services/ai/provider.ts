import { GoogleGenAI } from "@google/genai";
import { generateWithGemini } from "./gemini";
import { generateWithGroq } from "./groq";
import { generateWithCopilot, createEmbeddingWithCopilot } from "./copilot";
import { generateWithGeminiVision, type VisionImageInput } from "./vision";

export type { VisionImageInput };
export type AITask = 'generation' | 'review' | 'classification' | 'document_extraction' | 'playwright_codegen' | 'playwright_heal';

/**
 * GitHub Copilot dùng CHUNG 1 cặp model (primary + fallback) cho mọi task,
 * khác với Gemini vốn có model riêng theo từng task (xem getGeminiModelsForTask).
 */
function getCopilotModels(): string[] {
  return [process.env.AI_MODEL_COPILOT, process.env.AI_MODEL_COPILOT_FALLBACK].filter(
    (m): m is string => Boolean(m)
  );
}

function getGeminiModelsForTask(task: AITask): string[] {
  const primaryByTask: Record<AITask, string | undefined> = {
    generation: process.env.AI_MODEL_GENERATION,
    review: process.env.AI_MODEL_REVIEW,
    classification: process.env.AI_MODEL_CLASSIFICATION,
    document_extraction: process.env.AI_MODEL_DOCUMENT_EXTRACTION,
    // Playwright Automation Agent (Phase 3 roadmap item) - dedicated model, falls back
    // to AI_MODEL_FALLBACK -> Groq like every other task. Never hardcode a model id here.
    playwright_codegen: process.env.AI_MODEL_PLAYWRIGHT_CODEGEN,
    // Heal (Phase 4.5) - same prompt builder, one extra framing section (see
    // playwright-agent.ts's HEAL MODE) - cascades to AI_MODEL_PLAYWRIGHT_CODEGEN first
    // (a heal is still fundamentally a codegen call) so this works with zero extra
    // config, then AI_MODEL_FALLBACK like everything else if neither is set.
    playwright_heal: process.env.AI_MODEL_PLAYWRIGHT_HEAL ?? process.env.AI_MODEL_PLAYWRIGHT_CODEGEN,
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
  return [process.env.GROQ_MODEL_PRIMARY, process.env.GROQ_MODEL_FALLBACK].filter(
    (m): m is string => Boolean(m)
  );
}

export async function runAIAgent(
  fullPrompt: string,
  task: AITask = 'generation',
  responseSchema?: Record<string, unknown>
) {
  const systemPrompt = "You are a professional QA Assistant. Return ONLY valid JSON format.";

  // Thứ tự thử: GitHub Copilot -> Gemini -> Groq.
  try {
    return await generateWithCopilot(systemPrompt, fullPrompt, getCopilotModels());
  } catch (copilotError) {
    console.warn("⚠️ [Provider] Copilot thất bại. Đang chuyển qua Gemini...", copilotError);

    try {
      return await generateWithGemini(systemPrompt, fullPrompt, getGeminiModelsForTask(task), responseSchema);
    } catch (geminiError) {
      console.warn("⚠️ [Provider] Gemini thất bại. Đang chuyển qua Groq...", geminiError);

      try {
        return await generateWithGroq(systemPrompt, fullPrompt, getGroqModelsForTask());
      } catch (groqError) {
        console.error("❌ [Provider] Tất cả AI Model đều thất bại!", groqError);
        throw new Error(
          "Hệ thống AI hiện đang quá tải (Vượt quá Rate Limit của cả Copilot, Gemini lẫn Groq). Vui lòng đợi khoảng 1 phút rồi thử lại."
        );
      }
    }
  }
}

/**
 * Gọi Gemini ở chế độ vision để đọc ảnh diagram/ERD/UI mockup cho AI Document
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
 * Tạo vector embedding (RAG). Thứ tự thử: GitHub Copilot -> Gemini Embedding API.
 * Copilot chỉ được thử nếu đã cấu hình đủ GITHUB_COPILOT_TOKEN, GITHUB_COPILOT_BASE_URL
 * và AI_MODEL_COPILOT_EMBEDDING; nếu chưa cấu hình thì bỏ qua thẳng xuống Gemini
 * (không tính là fallback do lỗi).
 */
export async function createEmbedding(content: string): Promise<number[]> {
  const copilotConfigured = Boolean(
    process.env.GITHUB_COPILOT_TOKEN &&
    process.env.GITHUB_COPILOT_BASE_URL &&
    process.env.AI_MODEL_COPILOT_EMBEDDING
  );

  if (copilotConfigured) {
    try {
      return await createEmbeddingWithCopilot(content);
    } catch (copilotError) {
      console.warn("⚠️ [Provider] Copilot Embedding thất bại. Đang chuyển qua Gemini...", copilotError);
    }
  }

  return createEmbeddingWithGemini(content);
}

async function createEmbeddingWithGemini(content: string): Promise<number[]> {
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

    return response.embeddings[0].values as number[];
  } catch (error) {
    console.error("❌ Lỗi tạo Embedding:", error);
    throw error;
  }
}
