import { extractJson } from "./parse";

// ============================================================================
// File: copilot.ts
// Chức năng: Provider gọi GitHub Copilot (qua proxy nội bộ tương thích
// OpenAI Chat Completions / Embeddings). Đây là provider được thử ĐẦU TIÊN
// trong chuỗi fallback (Copilot -> Gemini -> Groq), xem provider.ts.
// ============================================================================

function getCopilotConfig() {
  const apiKey = process.env.GITHUB_COPILOT_TOKEN;
  const baseUrl = process.env.GITHUB_COPILOT_BASE_URL;

  if (!apiKey) {
    throw new Error('Thieu GITHUB_COPILOT_TOKEN trong bien moi truong server.');
  }
  if (!baseUrl) {
    throw new Error('Thieu GITHUB_COPILOT_BASE_URL trong bien moi truong server.');
  }

  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, '') };
}

function isFallbackWorthy(err: any): boolean {
  const status = err?.status || err?.code;
  const isJsonParseFailure =
    typeof err?.message === 'string' && err.message.includes('không đúng định dạng JSON');
  return status === 429 || status === 500 || status === 503 || isJsonParseFailure;
}

/**
 * Gọi 1 lượt Chat Completions tới Copilot proxy (OpenAI-compatible).
 */
async function callCopilotOnce(
  baseUrl: string,
  apiKey: string,
  model: string,
  systemPrompt: string,
  userPrompt: string
): Promise<any> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 8000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    const error: any = new Error(
      `Copilot API tra ve loi ${response.status}: ${errorBody || response.statusText}`
    );
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const rawContent = data?.choices?.[0]?.message?.content;
  if (!rawContent) throw new Error('Empty response from GitHub Copilot');

  return extractJson(rawContent);
}

/**
 * Sinh nội dung qua GitHub Copilot, thử lần lượt từng model trong danh sách
 * (primary -> fallback) trước khi báo lỗi để provider.ts chuyển sang Gemini.
 */
export async function generateWithCopilot(
  systemPrompt: string,
  userPrompt: string,
  models: string[]
): Promise<any> {
  const { apiKey, baseUrl } = getCopilotConfig();

  if (models.length === 0) {
    throw new Error('Khong co model Copilot nao duoc cau hinh.');
  }

  let lastError: any;

  for (const model of models) {
    try {
      return await callCopilotOnce(baseUrl, apiKey, model, systemPrompt, userPrompt);
    } catch (err: any) {
      lastError = err;

      if (!isFallbackWorthy(err)) {
        throw err;
      }

      console.warn(
        `⚠️ [Copilot] Model ${model} thất bại (Lỗi ${err?.status || 'JSON'}). Đang thử model kế tiếp...`
      );
    }
  }

  throw lastError;
}

/**
 * Tạo vector embedding qua GitHub Copilot proxy (nếu proxy hỗ trợ endpoint
 * /embeddings). Dùng làm lựa chọn đầu tiên trước khi rơi xuống Gemini.
 */
export async function createEmbeddingWithCopilot(content: string): Promise<number[]> {
  const { apiKey, baseUrl } = getCopilotConfig();
  const model = process.env.AI_MODEL_COPILOT_EMBEDDING;

  if (!model) {
    throw new Error('Thieu bien moi truong AI_MODEL_COPILOT_EMBEDDING.');
  }

  const response = await fetch(`${baseUrl}/embeddings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model, input: content }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    const error: any = new Error(
      `Copilot Embeddings API tra ve loi ${response.status}: ${errorBody || response.statusText}`
    );
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  const embedding = data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding) || embedding.length === 0) {
    throw new Error('Không nhận được dữ liệu embedding từ Copilot');
  }

  return embedding;
}
