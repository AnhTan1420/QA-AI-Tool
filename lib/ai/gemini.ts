import { GoogleGenAI } from "@google/genai";
import { extractJson } from "./parse";

/**
 * Goi Gemini voi danh sach model uu tien theo thu tu (model chinh truoc,
 * cac model du phong sau). Danh sach nay LUON duoc truyen tu ben ngoai
 * (provider.ts, doc tu bien moi truong theo tung tac vu) - file nay khong
 * tu quyet dinh model ID.
 */
export async function generateWithGemini(
  systemPrompt: string,
  userPrompt: string,
  models: string[]
): Promise<any> {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Thieu GOOGLE_GEMINI_API_KEY trong bien moi truong server.');
  }
  if (models.length === 0) {
    throw new Error('Khong co model Gemini nao duoc cau hinh cho tac vu nay.');
  }

  const ai = new GoogleGenAI({ apiKey });
  let lastError: any;

  for (const model of models) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.2,
          // Da tang tu 8192: voi minCases moi (toi thieu theo tung category, xem
          // generation-agent.ts) bo set co the len toi 30-40+ case chi tiet, de vuot
          // 8192 token va bi cat cut JSON giua chung neu khong nang tran nay len.
          maxOutputTokens: 16384,
          responseMimeType: "application/json", // Ép AI trả về chuẩn JSON
        },
      });

      if (!response.text) throw new Error("Empty response from Gemini");

      return extractJson(response.text);
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.code;

      const isJsonParseFailure = typeof err?.message === 'string' && err.message.includes('không đúng định dạng JSON');
      const isFallbackWorthy = status === 429 || status === 500 || status === 503 || isJsonParseFailure;

      if (!isFallbackWorthy) {
        throw err;
      }

      console.warn(`⚠️ [Gemini] Model ${model} thất bại (Lỗi ${status || "JSON"}). Đang thử model kế tiếp...`);
    }
  }

  throw lastError;
}
