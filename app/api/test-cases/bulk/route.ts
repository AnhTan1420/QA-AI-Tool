import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

// Lưu nhiều Test Cases cùng lúc (Dùng khi AI vừa sinh xong)
export async function POST(req: NextRequest) {
  try {
    const { testCases, projectId } = await req.json();

    if (!projectId || !testCases || !Array.isArray(testCases)) {
      return NextResponse.json({ success: false, error: 'Dữ liệu không hợp lệ' }, { status: 400 });
    }

    const payload = testCases.map(tc => ({
      project_id: projectId,
      code: tc.code || `TC-${Math.floor(Math.random()*10000)}`,
      title: tc.title,
      category: tc.category,
      priority: tc.priority,
      status: 'UNTESTED',
      preconditions: tc.preconditions || [],
      steps: tc.steps || [],
      final_expected_result: tc.final_expected_result || ''
    }));

    const { data, error } = await supabase
      .from('test_cases')
      .insert(payload)
      .select();

    if (error) throw error;

    return NextResponse.json({ success: true, data });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
