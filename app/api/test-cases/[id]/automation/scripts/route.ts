import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Lịch sử các bản Playwright script đã sinh cho 1 test case (bảng automation_scripts),
 * mới nhất lên đầu - cùng tinh thần với /api/test-cases/[id]/versions. Mỗi lần "Generate
 * Playwright Code" tạo 1 version mới (xem app/api/ai/playwright/route.ts), KHÔNG ghi đè.
 * RLS (automation_scripts_member_access) đã giới hạn chỉ thành viên project mới đọc được.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('automation_scripts')
    .select('id, version, page_objects, code, imports_used, selectors_used, warnings, environment, model_used, created_at, profiles(full_name)')
    .eq('test_case_id', id)
    .order('version', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
}
