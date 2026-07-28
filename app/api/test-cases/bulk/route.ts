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

    const supabase = await createClient();
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
