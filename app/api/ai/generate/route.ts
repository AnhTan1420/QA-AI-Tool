import { NextResponse } from 'next/server';
import { getAiProvider } from '@/lib/ai/provider';
import { buildGenerationPrompt } from '@/lib/ai/prompts/generation-agent';
import { generateRequestSchema } from '@/lib/validators/test-case';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const payload = generateRequestSchema.parse(await request.json());
    const provider = await getAiProvider();
    const testCases = await provider.generateTestCases({
      model: process.env.AI_MODEL_GENERATION ?? 'gemini-2.0-flash',
      prompt: buildGenerationPrompt(payload),
    });

    return NextResponse.json({ test_cases: testCases });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to generate test cases';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
