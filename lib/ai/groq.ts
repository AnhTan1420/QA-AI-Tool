import Groq from "groq-sdk";
import { extractJson } from "./parse";

/**
 * Fallback toc do cao khi Gemini rate-limit. Danh sach model duoc truyen tu
 * ben ngoai (provider.ts) - khong hard-code o day.
 */
export async function generateWithGroq(
  systemPrompt: string,
  userPrompt: string,
  models: string[]
): Promise<any> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('Thieu GROQ_API_KEY trong bien moi truong server.');
  }
  if (models.length === 0) {
    throw new Error('Khong co model Groq nao duoc cau hinh cho fallback.');
  }

  const groq = new Groq({ apiKey });
  let lastError: any;

  for (const model of models) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const rawContent = completion.choices[0]?.message?.content;
      if (!rawContent) throw new Error("Empty response from Groq");

      return extractJson(rawContent);
    } catch (err: any) {
      lastError = err;
      const status = err?.status;

      const isJsonParseFailure = typeof err?.message === 'string' && err.message.includes('không đúng định dạng JSON');
      const isFallbackWorthy = status === 429 || status === 500 || status === 503 || isJsonParseFailure;

      if (!isFallbackWorthy) {
        throw err;
      }

      console.warn(`⚠️ [Groq] Model ${model} thất bại (Lỗi ${status || "JSON"}). Đang thử model kế tiếp...`);
    }
  }

  throw lastError;
}
