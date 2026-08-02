import { GoogleGenAI } from "@google/genai";
import { extractJson } from "./parse";

/**
 * Goi Gemini o che do multimodal (text + anh) de doc diagram/ERD/UI mockup.
 * Cung 1 co che retry-qua-model-ke-tiep nhu generateWithGemini (lib/ai/gemini.ts),
 * nhung KHONG co fallback sang Groq vi groq-sdk trong project nay chi dung cho
 * text — vision la Gemini-only (xem lib/ai/provider.ts::runDocumentVisionAgent).
 */
export type VisionImageInput = { mimeType: string; base64Data: string };

export async function generateWithGeminiVision(
  systemPrompt: string,
  userPrompt: string,
  images: VisionImageInput[],
  models: string[],
): Promise<any> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Thieu GOOGLE_GEMINI_API_KEY trong bien moi truong server.');
  }
  if (models.length === 0) {
    throw new Error('Khong co model Gemini nao duoc cau hinh cho tac vu nay.');
  }
  if (images.length === 0) {
    throw new Error('Can it nhat 1 anh de phan tich.');
  }

  const ai = new GoogleGenAI({ apiKey });
  let lastError: any;

  const contents = [
    {
      role: 'user' as const,
      parts: [
        { text: userPrompt },
        ...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64Data } })),
      ],
    },
  ];

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.15,
          maxOutputTokens: 4096,
          responseMimeType: "application/json",
        },
      });

      if (!response.text) throw new Error("Empty response from Gemini Vision");

      return extractJson(response.text);
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.code;

      const isJsonParseFailure = typeof err?.message === 'string' && err.message.includes('không đúng định dạng JSON');
      const isFallbackWorthy = status === 429 || status === 500 || status === 503 || isJsonParseFailure;

      if (!isFallbackWorthy) {
        throw err;
      }

      console.warn(`⚠️ [Gemini Vision] Model ${model} thất bại (Lỗi ${status || "JSON"}). Đang thử model kế tiếp...`);
    }
  }

  throw lastError;
}
