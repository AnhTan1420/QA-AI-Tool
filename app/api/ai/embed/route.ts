import { z } from 'zod';
import { NextResponse } from 'next/server';
// 1. Sửa import: Lấy hàm createEmbedding thay vì getAiProvider
import { createEmbedding } from '@/lib/ai/provider'; 

export const runtime = 'nodejs';

const embedRequestSchema = z.object({
  content: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const payload = embedRequestSchema.parse(await request.json());
    
    // 2. Gọi thẳng hàm createEmbedding đã tạo ở provider.ts
    const embedding = await createEmbedding(payload.content);

    return NextResponse.json({ embedding });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create embedding';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}