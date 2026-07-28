import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Lấy danh sách Test Case từ Supabase Database
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId');

  if (!projectId) {
    return NextResponse.json({ success: false, error: 'Thiếu projectId' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('test_cases')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
}

// Cập nhật trạng thái Test Case (Pass/Fail/Skip)
export async function PATCH(req: NextRequest) {
  try {
    const { id, status } = await req.json();

    if (!id || !status) {
      return NextResponse.json({ success: false, error: 'Thiếu id hoặc status' }, { status: 400 });
    }

    const { data, error } = await supabase
      .from('test_cases')
      .update({ status })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
