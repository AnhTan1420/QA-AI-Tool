import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Xóa một project.
 * Cho phép Chủ sở hữu (projects.owner_id) HOẶC Admin của project (project_members.role = 'admin') xóa.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;
    const supabase = await createClient();

    // 1. Kiểm tra phiên đăng nhập
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Bạn cần đăng nhập.' },
        { status: 401 }
      );
    }

    // 2. Lấy thông tin Project để xác định Owner
    const { data: project, error: projectError } = await supabase
      .from('projects')
      .select('owner_id')
      .eq('id', projectId)
      .maybeSingle();

    if (projectError || !project) {
      return NextResponse.json(
        { success: false, error: 'Không tìm thấy project hoặc project đã bị xóa trước đó.' },
        { status: 404 }
      );
    }

    // 3. Lấy thông tin Membership để kiểm tra vai trò Admin
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
        { success: false, error: 'Chỉ Admin hoặc Chủ sở hữu (Owner) mới có quyền xóa project này.' },
        { status: 403 }
      );
    }

    // 4. Thực hiện xóa và dùng .select() để kiểm tra kết quả thực tế từ DB
    const { data: deletedRows, error: deleteError } = await supabase
      .from('projects')
      .delete()
      .eq('id', projectId)
      .select();

    if (deleteError) {
      return NextResponse.json(
        { success: false, error: `Lỗi Database: ${deleteError.message}` },
        { status: 500 }
      );
    }

    // Nếu RLS chặn ở tầng Database, deleteError không có nhưng deletedRows sẽ rỗng ([])
    if (!deletedRows || deletedRows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Không thể xóa project. Chính sách RLS trên Supabase đã chặn thao tác này.',
        },
        { status: 403 }
      );
    }

    return NextResponse.json({ success: true, data: { id: projectId } });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err?.message || 'Đã xảy ra lỗi hệ thống khi xóa project.' },
      { status: 500 }
    );
  }
}
