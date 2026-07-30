import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

const inviteSchema = z.object({
  email: z.string().email(),
  role: z.enum(['qa', 'admin']).default('admin'),
});

const updateRoleSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(['qa', 'senior_qa', 'admin']),
});

/** Danh sach thanh vien cua 1 project, kem thong tin profile (RLS da gioi han theo project_members). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('project_members')
    .select('user_id, role, joined_at, profiles(full_name, avatar_url)')
    .eq('project_id', projectId);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
}

/**
 * Moi thanh vien vao project bang email. Can service role de tra cuu user theo email
 * (Supabase Auth khong expose viec nay qua client thong thuong vi ly do bao mat) -
 * nhung viec THEM vao project_members van di qua RLS cua client thong thuong,
 * dam bao chi admin cua project moi moi duoc thanh vien.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const payload = inviteSchema.parse(await req.json());

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Bạn cần đăng nhập.' }, { status: 401 });
    }

    // Chi admin cua project moi duoc moi thanh vien.
    const { data: membership } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership || membership.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Chỉ admin của project mới được mời thành viên.' }, { status: 403 });
    }

    const admin = createAdminClient();
    // MVP: quet toi da 200 user dau tien de tim theo email. Voi workspace lon hon,
    // nen thay bang bang mapping email rieng hoac Supabase Admin API co filter email.
    const { data: userList, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 });
    if (listError) {
      return NextResponse.json({ success: false, error: listError.message }, { status: 500 });
    }

    const targetUser = userList.users.find((u) => u.email?.toLowerCase() === payload.email.toLowerCase());
    if (!targetUser) {
      return NextResponse.json(
        { success: false, error: 'Không tìm thấy tài khoản với email này. Người dùng cần đăng ký QAJD trước.' },
        { status: 404 }
      );
    }

    const { error: insertError } = await supabase
      .from('project_members')
      .insert({ project_id: projectId, user_id: targetUser.id, role: payload.role });

    if (insertError) {
      return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: { user_id: targetUser.id, role: payload.role } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể mời thành viên';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

/**
 * Doi role cua 1 thanh vien trong project. RLS (project_members_manage_admin) da
 * gioi han chi admin cua project moi UPDATE duoc project_members, nen o day chi
 * can guard them 1 truong hop nghiep vu: khong cho ha role cua admin cuoi cung
 * (tranh project bi "mo coi", khong con ai quan ly thanh vien).
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await params;
    const payload = updateRoleSchema.parse(await req.json());

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Bạn cần đăng nhập.' }, { status: 401 });
    }

    const { data: membership } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership || membership.role !== 'admin') {
      return NextResponse.json({ success: false, error: 'Chỉ admin của project mới được đổi vai trò thành viên.' }, { status: 403 });
    }

    if (payload.role !== 'admin') {
      const { count } = await supabase
        .from('project_members')
        .select('user_id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('role', 'admin');

      const { data: target } = await supabase
        .from('project_members')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', payload.user_id)
        .maybeSingle();

      if (target?.role === 'admin' && (count ?? 0) <= 1) {
        return NextResponse.json(
          { success: false, error: 'Không thể hạ vai trò của admin cuối cùng trong project.' },
          { status: 400 }
        );
      }
    }

    const { data, error } = await supabase
      .from('project_members')
      .update({ role: payload.role })
      .eq('project_id', projectId)
      .eq('user_id', payload.user_id)
      .select('user_id, role, joined_at, profiles(full_name, avatar_url)')
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể cập nhật vai trò';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
