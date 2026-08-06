import { GoogleGenAI } from "@google/genai";
import { extractJson } from "./parse";

async function callGeminiOnce(
  ai: GoogleGenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  responseSchema?: Record<string, unknown>
): Promise<any> {
  const response = await ai.models.generateContent({
    model,
    contents: userPrompt,
    config: {
      systemInstruction: systemPrompt,
      temperature: 0.2,
      maxOutputTokens: 16384,
      responseMimeType: "application/json", 
      ...(responseSchema ? { responseSchema: responseSchema as any } : {}),
    },
  });

  if (!response.text) throw new Error("Empty response from Gemini");

  return extractJson(response.text);
}

export async function generateWithGemini(
  systemPrompt: string,
  userPrompt: string,
  models: string[],
  responseSchema?: Record<string, unknown>
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
      return await callGeminiOnce(ai, model, systemPrompt, userPrompt, responseSchema);
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.code;

      const isJsonParseFailure = typeof err?.message === 'string' && err.message.includes('không đúng định dạng JSON');
      const isFallbackWorthy = status === 429 || status === 500 || status === 503 || isJsonParseFailure;
      
      if (!isFallbackWorthy && responseSchema) {
        console.warn(`⚠️ [Gemini] Model ${model} lỗi khi dùng responseSchema (${err?.message || status}). Thử lại KHÔNG kèm schema...`);
        try {
          return await callGeminiOnce(ai, model, systemPrompt, userPrompt, undefined);
        } catch (retryErr: any) {
          lastError = retryErr;
          const retryStatus = retryErr?.status || retryErr?.code;
          const retryIsJsonParseFailure = typeof retryErr?.message === 'string' && retryErr.message.includes('không đúng định dạng JSON');
          const retryIsFallbackWorthy = retryStatus === 429 || retryStatus === 500 || retryStatus === 503 || retryIsJsonParseFailure;

          if (!retryIsFallbackWorthy) {
            throw retryErr;
          }
          console.warn(`⚠️ [Gemini] Model ${model} vẫn thất bại sau khi bỏ schema (Lỗi ${retryStatus || "JSON"}). Đang thử model kế tiếp...`);
          continue;
        }
      }

      if (!isFallbackWorthy) {
        throw err;
      }

      console.warn(`⚠️ [Gemini] Model ${model} thất bại (Lỗi ${status || "JSON"}). Đang thử model kế tiếp...`);
    }
  }

  throw lastError;
}
