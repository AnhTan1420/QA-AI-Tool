import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Lich su chinh sua cua 1 test case (bang test_case_versions). Moi lan PUT
 * /api/test-cases/[id] se chup 1 snapshot TRUOC khi ghi de - nen danh sach nay
 * la "trang thai truoc moi lan sua", moi nhat len dau. RLS (test_case_versions_member_access)
 * da gioi han chi thanh vien project moi doc duoc.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('test_case_versions')
    .select('id, snapshot, edited_at, edited_by, profiles(full_name, avatar_url)')
    .eq('test_case_id', id)
    .order('edited_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
}
