import type { GeneratedTestCase, ReviewResult } from '@/lib/validators/test-case';

export type GenerateTestCasesInput = {
  prompt: string;
  model: string;
};

export type ReviewTestCasesInput = {
  prompt: string;
  model: string;
};

export type EmbeddingInput = {
  content: string;
  model: string;
};

export interface AiProvider {
  generateTestCases(input: GenerateTestCasesInput): Promise<GeneratedTestCase[]>;
  reviewTestCases(input: ReviewTestCasesInput): Promise<ReviewResult>;
  embed(input: EmbeddingInput): Promise<number[]>;
}

export function parseJsonPayload<T>(raw: string | undefined): T {
  if (!raw) {
    throw new Error('AI provider returned an empty response');
  }

  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```$/i, '')
    .trim();

  return JSON.parse(cleaned) as T;
}

export async function getAiProvider(name = process.env.AI_PROVIDER ?? 'gemini'): Promise<AiProvider> {
  if (name === 'groq') {
    const { groqProvider } = await import('./groq');
    return groqProvider;
  }

  const { geminiProvider } = await import('./gemini');
  return geminiProvider;
}
