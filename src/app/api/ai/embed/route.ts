import { z } from 'zod';
import { NextResponse } from 'next/server';
// 1. Sửa import: Lấy hàm createEmbedding thay vì getAiProvider
import { createEmbedding } from '@/services/ai/provider'; 

export const runtime = 'nodejs';

const embedRequestSchema = z.object({
  content: z.string().min(1),
});

export async function POST(request: Request) {
  try {
    const payload = embedRequestSchema.parse(await request.json());
    
    // 2. Gọi thẳng hàm createEmbedding đã tạo ở provider.ts
    const embedding = await createEmbedding(payload.content);

    return NextResponse.json({ success: true, data: { embedding } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to create embedding';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}