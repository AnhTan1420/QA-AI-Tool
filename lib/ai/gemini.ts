import { GoogleGenAI } from "@google/genai";

const GEMINI_MODELS = [
  process.env.GEMINI_MODEL ?? "gemini-3.6-flash", // Ưu tiên 1
  "gemini-3.5-flash-lite",                        // Dự phòng nội bộ 1 (Quota lớn hơn)
];

export async function generateWithGemini(systemPrompt: string, userPrompt: string): Promise<any> {
  const ai = new GoogleGenAI({ apiKey: process.env.GOOGLE_GEMINI_API_KEY });
  let lastError: any;

  for (const model of GEMINI_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          temperature: 0.2,
          responseMimeType: "application/json", // Ép AI trả về chuẩn JSON
        },
      });

      if (!response.text) throw new Error("Empty response from Gemini");
      
      // Parse và trả về object JSON luôn
      return JSON.parse(response.text);
      
    } catch (err: any) {
      lastError = err;
      const status = err?.status || err?.code;
      
      // Chỉ tự động thử model khác nếu bị Rate Limit (429), Server Error (50x) hoặc lỗi JSON
      const isFallbackWorthy = status === 429 || status === 500 || status === 503 || err instanceof SyntaxError;
      
      if (!isFallbackWorthy) {
        throw err; // Nếu lỗi 400 (nhập sai param) thì văng lỗi luôn
      }
      
      console.warn(`⚠️ [Gemini] Model ${model} thất bại (Lỗi ${status || "JSON"}). Đang thử model kế tiếp...`);
    }
  }
  
  throw lastError; // Hết model để thử -> Quăng lỗi lên cho provider.ts xử lý
}