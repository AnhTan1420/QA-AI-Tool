import { z } from 'zod';
import { NextResponse } from 'next/server';
// 1. Sửa import: Lấy hàm createEmbedding thay vì getAiProvider
import { createEmbedding } from '@/services/ai/provider'; 

export const runtime = 'nodejs';
// 1 lan goi Gemini (embedding / khong co goi Gemini truc tiep o retrieve) --
// nhe hon nhieu so voi generate/enhance/parse, nhung van khai bao ro rang thay
// vi de mac dinh nen tang cua platform (day chinh la loi da xay ra o route
// parse: mac dinh 120s hoac thap hon khong duoc XEM XET lai khi kien truc ben
// duoi thay doi).
export const maxDuration = 120;

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