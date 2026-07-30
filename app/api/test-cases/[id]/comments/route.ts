import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const createCommentSchema = z.object({
  content: z.string().min(1, 'Nội dung comment không được để trống').max(4000),
});

/** Danh sach comment cua 1 test case, cu nhat len dau (RLS: comments_member_access). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('comments')
    .select('id, content, created_at, user_id, profiles(full_name, avatar_url)')
    .eq('test_case_id', id)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
}

/**
 * Tao comment moi. Client (browser) se nhan duoc row moi qua Supabase Realtime
 * (postgres_changes INSERT tren bang comments, publication da bat trong schema.sql)
 * nen o day chi can insert va tra ve row vua tao cho chinh nguoi gui dung ngay.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const payload = createCommentSchema.parse(await req.json());

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Bạn cần đăng nhập.' }, { status: 401 });
    }

    const { data, error } = await supabase
      .from('comments')
      .insert({ test_case_id: id, user_id: user.id, content: payload.content })
      .select('id, content, created_at, user_id, profiles(full_name, avatar_url)')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể gửi comment';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
