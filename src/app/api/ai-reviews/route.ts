import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/services/supabase/server';
import { reviewResultSchema } from '@/models/validators/test-case';

const persistReviewSchema = z.object({
  set_id: z.string().uuid(),
  review: reviewResultSchema,
});

/**
 * Luu ket qua Senior QA Review Agent (da chay tu /api/ai/review) vao DB, gan voi
 * 1 test_case_set cu the - de xem lai coverage score sau nay ma khong can goi lai AI.
 */
export async function POST(req: NextRequest) {
  try {
    const payload = persistReviewSchema.parse(await req.json());
    const supabase = await createClient();

    const { data, error } = await supabase
      .from('ai_reviews')
      .insert({
        set_id: payload.set_id,
        coverage_score: payload.review.coverage_score,
        review_payload: payload.review,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    // Danh dau set da qua review, giup UI/list phan biet voi set moi tao "generating".
    await supabase.from('test_case_sets').update({ status: 'reviewed' }).eq('id', payload.set_id);

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể lưu kết quả review';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
