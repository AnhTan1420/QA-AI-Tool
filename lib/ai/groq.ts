import Groq from 'groq-sdk';
import { generatedTestCasesSchema, reviewResultSchema } from '@/lib/validators/test-case';
import { parseJsonPayload, type AiProvider } from './provider';

function getClient() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GROQ_API_KEY');
  }
  return new Groq({ apiKey });
}

async function completeJson(prompt: string, model: string) {
  const groq = getClient();
  const response = await groq.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.2,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error('Groq returned an empty response');
  }

  return content;
}

export const groqProvider: AiProvider = {
  async generateTestCases(input) {
    const raw = await completeJson(input.prompt, input.model);
    const parsed = parseJsonPayload<unknown>(raw);
    return generatedTestCasesSchema.parse(Array.isArray(parsed) ? parsed : (parsed as { test_cases?: unknown }).test_cases);
  },

  async reviewTestCases(input) {
    const raw = await completeJson(input.prompt, input.model);
    return reviewResultSchema.parse(parseJsonPayload(raw));
  },

  async embed() {
    throw new Error('Groq provider does not support embeddings; use Gemini Embedding API for RAG.');
  },
};
