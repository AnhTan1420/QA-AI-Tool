import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const supabase = await createClient();

    // 1. Kiểm tra đăng nhập
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: 'Bạn cần đăng nhập.' }, { status: 401 });
    }

    // 2. Lấy thông tin Project
    const { data: project } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .maybeSingle();

    if (!project) {
      return NextResponse.json({ success: false, error: 'Project không tồn tại.' }, { status: 404 });
    }

    // 3. Kiểm tra vai trò Admin / Owner
    const { data: membership } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle();

    const isOwner = project.owner_id === user.id;
    const isAdmin = membership?.role === 'admin';

    if (!isOwner && !isAdmin) {
      return NextResponse.json(
        { success: false, error: 'Chỉ admin của project mới được xóa.' },
        { status: 403 }
      );
    }

    // 4. Thực hiện xóa project
    const { error } = await supabase.from('projects').delete().eq('id', projectId);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: { id: projectId } });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Lỗi server' },
      { status: 500 }
    );
  }
}
