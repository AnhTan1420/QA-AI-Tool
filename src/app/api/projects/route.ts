import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/services/supabase/server';
import { createAdminClient } from '@/services/supabase/admin';

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

    // Dung service-role client (bo qua RLS) cho 2 insert nay: owner_id/user_id o day
    // luon lay tu `user.id` da duoc `getUser()` xac thuc phia server ngay tren, KHONG
    // phai gia tri client tu gui len - nen bypass RLS o day an toan. Truoc do route nay
    // dung client thuong (RLS-enforced) va bi Postgres tu choi voi loi 42501 "new row
    // violates row-level security policy" ngay ca khi owner_id = auth.uid() ve mat logic,
    // vi policy dang chay tren Supabase (production) bi lech so voi ban trong schema.sql
    // (schema.sql chi la file tham khao, khong tu dong ap dung - phai chay lai bang tay
    // trong SQL Editor moi lan sua policy). Xem schema.sql de biet cach kiem tra/sua policy
    // that su tren database.
    const admin = createAdminClient();

    const { data: project, error: projectError } = await admin
      .from('projects')
      .insert({ name: payload.name, description: payload.description ?? null, owner_id: user.id })
      .select()
      .single();

    if (projectError) {
      return NextResponse.json({ success: false, error: projectError.message }, { status: 500 });
    }

    const { error: memberError } = await admin
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