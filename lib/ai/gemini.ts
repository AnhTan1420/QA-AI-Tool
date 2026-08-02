import { GoogleGenAI } from "@google/genai";
import { extractJson } from "./parse";

/**
 * 1 lan goi generateContent thuc su - tach rieng thanh ham nho de co the goi
 * lai CHINH model do 1 lan nua ma khong lap code (co schema / bo schema),
 * xem retry-without-schema trong generateWithGemini ben duoi.
 */
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
      // Da tang tu 8192: voi minCases moi (toi thieu theo tung category, xem
      // generation-agent.ts) bo set co the len toi 30-40+ case chi tiet, de vuot
      // 8192 token va bi cat cut JSON giua chung neu khong nang tran nay len.
      maxOutputTokens: 16384,
      responseMimeType: "application/json", // Ép AI trả về chuẩn JSON
      // Structured Output / Controlled Generation: ép cấu trúc + THỨ TỰ key
      // (propertyOrdering) ở cấp API, không chỉ dựa vào prompt text - xem
      // lib/ai/prompts/generation-response-schema.ts. Chỉ tác vụ nào truyền
      // responseSchema vào mới bật tính năng này; các tác vụ khác (review,
      // classification, document_extraction) không đổi hành vi.
      ...(responseSchema ? { responseSchema: responseSchema as any } : {}),
    },
  });

  if (!response.text) throw new Error("Empty response from Gemini");

  return extractJson(response.text);
}

/**
 * Goi Gemini voi danh sach model uu tien theo thu tu (model chinh truoc,
 * cac model du phong sau). Danh sach nay LUON duoc truyen tu ben ngoai
 * (provider.ts, doc tu bien moi truong theo tung tac vu) - file nay khong
 * tu quyet dinh model ID.
 *
 * `responseSchema` (optional): Gemini Structured Output schema - hien tai chi
 * tac vu "generation" truyen vao (xem provider.ts + app/api/ai/generate/route.ts).
 */
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

      // Loi KHONG thuoc dang "ha tang tam thoi" (khac 429/500/503, khong phai
      // loi parse JSON) trong khi dang dung responseSchema RAT CO THE la do
      // chinh schema: model nay (hoac phien ban API hien tai) khong tuong
      // thich voi 1 dac tinh nao do cua schema (VD enum long nhau,
      // propertyOrdering...) va API tra ve 400 INVALID_ARGUMENT. Thay vi bo
      // cuoc voi model nay ngay (nhu code cu se lam voi loi non-fallback-
      // worthy), thu lai CHINH model do 1 lan nhung KHONG kem schema - tuc la
      // lui ve dua vao prompt text de huong dan cau truc (PHASE 0 trong
      // generation-agent.ts van con nguyen), thay vi de ca tinh nang generate
      // bi sap chi vi 1 model khong tuong thich schema.
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
