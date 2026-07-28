import { GoogleGenAI } from "@google/genai";
import { generatedTestCasesSchema, reviewResultSchema } from '@/lib/validators/test-case';
import { parseJsonPayload, type AiProvider } from './provider';

function getClient() {
  const apiKey = process.env.GOOGLE_GEMINI_API_KEY ;
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY');
  }
  return new GoogleGenAI({ apiKey });
}

export const geminiProvider: AiProvider = {
  async generateTestCases(input) {
    const ai = getClient();
    const response = await ai.models.generateContent({
      model: input.model,
      contents: input.prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    return generatedTestCasesSchema.parse(parseJsonPayload(response.text));
  },

  async reviewTestCases(input) {
    const ai = getClient();
    const response = await ai.models.generateContent({
      model: input.model,
      contents: input.prompt,
      config: {
        responseMimeType: 'application/json',
      },
    });

    return reviewResultSchema.parse(parseJsonPayload(response.text));
  },

  async embed(input) {
    const ai = getClient();
    const response = await ai.models.embedContent({
      model: input.model,
      contents: input.content,
    });

    const values = response.embeddings?.[0]?.values;
    if (!values?.length) {
      throw new Error('Gemini returned an empty embedding');
    }
    return values;
  },
};
