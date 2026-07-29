import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { generatedTestCasesSchema } from '@/lib/validators/test-case';

const bulkCreateSchema = z.object({
  set_id: z.string().uuid(),
  test_cases: generatedTestCasesSchema,
});

export async function POST(req: NextRequest) {
  try {
    const payload = bulkCreateSchema.parse(await req.json());
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Bạn cần đăng nhập.' }, { status: 401 });
    }

    // CHECK: set_id tồn tại và user có quyền với project của set đó
    const { data: setData, error: setError } = await supabase
      .from('test_case_sets')
      .select('project_id')
      .eq('id', payload.set_id)
      .single();

    if (setError || !setData) {
      return NextResponse.json({ success: false, error: 'Test case set không tồn tại.' }, { status: 404 });
    }

    const { data: member } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', setData.project_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!member) {
      return NextResponse.json({ success: false, error: 'Không có quyền.' }, { status: 403 });
    }

    const rows = payload.test_cases.map((testCase) => ({
      set_id: payload.set_id,
      code: testCase.code,
      title: testCase.title,
      category: testCase.category,
      priority: testCase.priority,
      preconditions: testCase.preconditions,
      test_data: testCase.test_data ?? {},
      steps: testCase.steps,
      expected_result: testCase.final_expected_result,
      status: 'draft',
    }));

    const { data, error } = await supabase.from('test_cases').insert(rows).select();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể lưu test case';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
