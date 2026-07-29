import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const createProjectSchema = z.object({
  name: z.string().min(2, 'Tên project tối thiểu 2 ký tự'),
  description: z.string().optional(),
});

/** Danh sach project ma user hien tai la thanh vien (RLS da tu loc, nhung join ro cho de doc). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: 'Bạn cần đăng nhập.' }, { status: 401 });
  }

  const { data, error } = await supabase
    .from('projects')
    .select('id, name, description, created_at')
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
}

/** Tao project moi + tu dong them nguoi tao vao project_members voi role admin. */
export async function POST(req: NextRequest) {
  try {
    const payload = createProjectSchema.parse(await req.json());
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: 'Bạn cần đăng nhập.' }, { status: 401 });
    }

    // Kiem tra them session/access_token thuc su ton tai - getUser() co the tra ve user
    // tu mot lan xac thuc truoc do trong khi access_token dinh kem cho cac request sau
    // (nhu insert ben duoi) da het han/khong hop le, khien auth.uid() = NULL o phia DB
    // va RLS tu choi voi thong bao chung chung "new row violates row-level security policy".
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      return NextResponse.json(
        {
          success: false,
          error: 'Phiên đăng nhập không hợp lệ (thiếu access token). Hãy đăng xuất rồi đăng nhập lại.',
        },
        { status: 401 }
      );
    }

    const { data: project, error: projectError } = await supabase
      .from('projects')
      .insert({ name: payload.name, description: payload.description ?? null, owner_id: user.id })
      .select()
      .single();

    if (projectError) {
      const hint =
        projectError.code === '42501'
          ? ' (RLS từ chối — kiểm tra owner_id có đúng auth.uid() không, hoặc thử đăng xuất/đăng nhập lại để làm mới session.)'
          : '';
      return NextResponse.json({ success: false, error: projectError.message + hint }, { status: 500 });
    }

    const { error: memberError } = await supabase
      .from('project_members')
      .insert({ project_id: project.id, user_id: user.id, role: 'admin' });

    if (memberError) {
      return NextResponse.json({ success: false, error: memberError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: project });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể tạo project';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
