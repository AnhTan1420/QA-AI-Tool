// ============================================================================
// File: src/services/ai/provider.ts
// LOP DIEU PHOI AI — GEMINI ONLY.
// ----------------------------------------------------------------------------
//   runAIAgent() / runGeminiTask() / runDocumentVisionAgent() / createEmbedding()
//         ↓
//   getModelChain(task)        (model-registry.ts — Gemini only)
//         ↓
//   generateWithGeminiResilient()  (gemini.ts — retry/backoff/jitter/timeout)
//         ↓
//   ket qua JSON da validate
//
// KHONG CON provider-routing nao khac. Khong Copilot, khong Groq, khong proxy.
// Neu can them mot tac vu AI moi: them vao `AITask` trong model-registry.ts —
// KHONG duoc them provider moi o day.
// ============================================================================

import {
  createGeminiEmbedding,
  generateWithGeminiResilient,
  type GeminiCallResult,
  type VisionImageInput,
} from './gemini';
import type { AITask } from './model-registry';

export type { VisionImageInput, AITask };
export { GeminiProviderError } from './errors';

const QA_SYSTEM_PROMPT = 'You are a professional QA Assistant. Return ONLY valid JSON format.';
const VISION_SYSTEM_PROMPT =
  'You are a meticulous Document Vision Analyst for a QA test-case tool. Return ONLY valid JSON format.';

/**
 * Goi 1 tac vu Gemini co validate o muc ung dung. Day la entrypoint DUOC UU TIEN
 * cho moi luong nghiep vu moi: `validate` bat buoc phai nem loi neu du lieu sai,
 * de engine coi do la phan hoi hong va tu retry/doi model thay vi tra rac ve route.
 */
export async function runGeminiTask<T>(options: {
  task: AITask;
  prompt: string;
  systemPrompt?: string;
  responseSchema?: Record<string, unknown>;
  validate: (raw: unknown) => T;
  models?: string[];
  temperature?: number;
  maxOutputTokens?: number;
  label?: string;
}): Promise<GeminiCallResult<T>> {
  return generateWithGeminiResilient<T>({
    task: options.task,
    systemPrompt: options.systemPrompt ?? QA_SYSTEM_PROMPT,
    userPrompt: options.prompt,
    responseSchema: options.responseSchema,
    validate: options.validate,
    models: options.models,
    temperature: options.temperature,
    maxOutputTokens: options.maxOutputTokens,
    label: options.label,
  });
}

/**
 * Entrypoint tuong thich nguoc cho cac route tu Zod-parse ket qua (playwright
 * codegen/heal, document extraction). Tra ve JSON THO da parse — nhung caller
 * VAN PHAI validate truoc khi dung/luu (xem quy tac "never trust AI output").
 */
export async function runAIAgent(
  fullPrompt: string,
  task: AITask = 'generation',
  responseSchema?: Record<string, unknown>,
): Promise<unknown> {
  const result = await generateWithGeminiResilient<unknown>({
    task,
    systemPrompt: QA_SYSTEM_PROMPT,
    userPrompt: fullPrompt,
    responseSchema,
  });
  return result.data;
}

/**
 * Gemini o che do vision (multimodal) de doc anh diagram/ERD/UI mockup.
 * Dung CHUNG engine resilient voi text — truoc day vision co bo quy tac fallback
 * rieng (khong retry, khong timeout), nen 1 loi 503 lam hong ca luong parse tai lieu.
 */
export async function runDocumentVisionAgent(
  fullPrompt: string,
  images: VisionImageInput[],
): Promise<unknown> {
  if (images.length === 0) {
    throw new Error('Cần ít nhất 1 ảnh để phân tích.');
  }

  const result = await generateWithGeminiResilient<unknown>({
    task: 'document_extraction',
    systemPrompt: VISION_SYSTEM_PROMPT,
    userPrompt: fullPrompt,
    images,
    temperature: 0.15,
    maxOutputTokens: 8192,
    label: 'vision',
  });
  return result.data;
}

/** Vector embedding cho RAG — Gemini only (AI_MODEL_EMBEDDING). */
export async function createEmbedding(content: string): Promise<number[]> {
  return createGeminiEmbedding(content);
}
