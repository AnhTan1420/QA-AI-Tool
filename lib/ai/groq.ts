import Groq from "groq-sdk";

const GROQ_MODELS = [
  process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile", // Ưu tiên 1 bên Groq
  "llama-3.1-8b-instant",                              // Dự phòng nội bộ 2
];

export async function generateWithGroq(systemPrompt: string, userPrompt: string): Promise<any> {
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  let lastError: any;

  for (const model of GROQ_MODELS) {
    try {
      const completion = await groq.chat.completions.create({
        model,
        temperature: 0.2,
        response_format: { type: "json_object" }, // Ép AI trả về JSON
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const rawContent = completion.choices[0]?.message?.content;
      if (!rawContent) throw new Error("Empty response from Groq");
      
      // Parse và trả về object JSON luôn
      return JSON.parse(rawContent);
      
    } catch (err: any) {
      lastError = err;
      const status = err?.status;
      
      const isFallbackWorthy = status === 429 || status === 500 || status === 503 || err instanceof SyntaxError;
      
      if (!isFallbackWorthy) {
        throw err;
      }
      
      console.warn(`⚠️ [Groq] Model ${model} thất bại (Lỗi ${status || "JSON"}). Đang thử model kế tiếp...`);
    }
  }
  
  throw lastError; // Hết model -> Bó tay
}