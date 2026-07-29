import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Xoa mot project. Chi admin cua project (project_members.role = 'admin') moi duoc xoa.
 * RLS o tang DB (policy projects_delete_admin trong schema.sql) cung chan viec nay -
 * kiem tra rieng o day de tra ve thong bao loi ro rang cho client thay vi loi RLS chung chung.
 * Cac bang con (test_cases, project_members, ai_reviews, ...) da khai bao
 * "on delete cascade" ve projects(id) nen se tu dong bi xoa theo.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
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
    return NextResponse.json(
      { success: false, error: 'Chỉ admin của project mới được xóa project.' },
      { status: 403 }
    );
  }

  const { error } = await supabase.from('projects').delete().eq('id', projectId);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: { id: projectId } });
}
