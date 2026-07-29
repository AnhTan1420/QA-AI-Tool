import type { getDictionary } from '@/lib/i18n/dictionaries';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { z } from 'zod';
import { generatedTestCaseSchema } from '@/lib/validators/test-case';

const updateSchema = z.object({
  code: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  category: generatedTestCaseSchema.shape.category.optional(),
  priority: generatedTestCaseSchema.shape.priority.optional(),
  preconditions: z.array(z.string()).optional(),
  test_data: z.record(z.string()).optional(),
  steps: z.array(z.object({
    step_number: z.coerce.number().int().positive(),
    action: z.string().min(1),
    expected_result: z.string().min(1),
  })).min(1).optional(),
  expected_result: z.string().min(1).optional(),
  status: z.enum(['draft', 'in_review', 'approved']).optional(),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('test_cases')
    .select('*, test_case_sets!inner(project_id)')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[API GET test-case] Supabase error:', error.message);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json(
      { success: false, error: 'Test case không tồn tại hoặc bạn không có quyền truy cập' },
      { status: 404 }
    );
  }

  const { test_case_sets, ...testCaseData } = data as any;
  return NextResponse.json({ success: true, data: testCaseData });
}

export async function PUT(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await _req.json();
    const payload = updateSchema.parse(body);

    const supabase = await createClient();

    const { data: current, error: fetchError } = await supabase
      .from('test_cases')
      .select('*, test_case_sets!inner(project_id)')
      .eq('id', id)
      .maybeSingle();

    if (fetchError || !current) {
      return NextResponse.json(
        { success: false, error: fetchError?.message || 'Test case không tồn tại' },
        { status: 404 }
      );
    }

    const { error: versionError } = await supabase
      .from('test_case_versions')
      .insert({
        test_case_id: id,
        snapshot: current,
      });

    if (versionError) {
      console.error('Lỗi lưu version:', versionError.message);
    }

    const { data, error } = await supabase
      .from('test_cases')
      .update({
        ...payload,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể cập nhật test case';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { error } = await supabase.from('test_cases').delete().eq('id', id);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: { id } });
}