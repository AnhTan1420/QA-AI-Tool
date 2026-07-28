import { z } from 'zod';
import { NextResponse } from 'next/server';
import { getAiProvider } from '@/lib/ai/provider';

export const runtime = 'nodejs';

const embedRequestSchema = z.object({
  content: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const payload = embedRequestSchema.parse(await request.json());
    const provider = await getAiProvider('gemini');
    const embedding = await provider.embed({
      content: payload.content,
      model: process.env.AI_MODEL_EMBEDDING ?? 'text-embedding-004',
    });

    return NextResponse.json({ embedding });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create embedding';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
