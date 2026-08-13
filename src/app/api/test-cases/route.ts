import type { getDictionary } from '@/lib/i18n/dictionaries';
import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/services/supabase/server';
import { generatedTestCaseSchema } from '@/models/validators/test-case';

const statusSchema = z.enum(['draft', 'in_review', 'approved']);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId');

  if (!projectId) {
    return NextResponse.json({ success: false, error: 'Thiếu projectId' }, { status: 400 });
  }

  const supabase = await createClient();
  // Danh sách chỉ render code/title/category/priority/status/automation_status (xem
  // TestCaseTable) - trước đây select('*') kéo theo cả steps/preconditions/test_data/
  // expected_result (jsonb, có thể rất nặng khi nhiều bước) cho TỪNG test case trong
  // project, dù trang list không dùng tới. Đây là nguyên nhân chính khiến trang chậm
  // khi project có nhiều test case. Sort theo `code` ngay tại DB luôn, khỏi phải kéo
  // hết mảng về rồi sort lại ở client (frontend trước đây tự .sort() sau khi fetch).
  const { data, error } = await supabase
    .from('test_cases')
    .select('id, code, title, category, priority, status, automation_status, test_case_sets!inner(project_id)')
    .eq('test_case_sets.project_id', projectId)
    .order('code', { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const createSchema = z.object({
      project_id: z.string().uuid(),
      code: z.string().min(1),
      title: z.string().min(1),
      category: generatedTestCaseSchema.shape.category,
      priority: generatedTestCaseSchema.shape.priority,
      preconditions: z.array(z.string()).default([]),
      test_data: z.record(z.string()).default({}),
      steps: z.array(z.object({
        step_number: z.coerce.number().int().positive(),
        action: z.string().min(1),
        expected_result: z.string().min(1),
      })).min(1),
      expected_result: z.string().min(1),
      status: statusSchema.default('draft'),
    });

    const payload = createSchema.parse(body);
    const supabase = await createClient();

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Bạn cần đăng nhập.' }, { status: 401 });
    }

    // CHECK: User có phải member của project không?
    const { data: member, error: memberError } = await supabase
      .from('project_members')
      .select('role')
      .eq('project_id', payload.project_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (memberError || !member) {
      return NextResponse.json(
        { success: false, error: 'Bạn không có quyền tạo test case cho project này.' },
        { status: 403 }
      );
    }

    const { data: existingSet } = await supabase
      .from('test_case_sets')
      .select('id')
      .eq('project_id', payload.project_id)
      .is('requirement_id', null)
      .eq('status', 'approved')
      .single();

    let setId: string;

    if (existingSet) {
      setId = existingSet.id;
    } else {
      const { data: newSet, error: setError } = await supabase
        .from('test_case_sets')
        .insert({
          project_id: payload.project_id,
          status: 'approved',
        })
        .select('id')
        .single();

      if (setError || !newSet) {
        return NextResponse.json({ success: false, error: setError?.message || 'Không tạo được test case set' }, { status: 500 });
      }
      setId = newSet.id;
    }

    const { data, error } = await supabase
      .from('test_cases')
      .insert({
        set_id: setId,
        code: payload.code,
        title: payload.title,
        category: payload.category,
        priority: payload.priority,
        preconditions: payload.preconditions,
        test_data: payload.test_data,
        steps: payload.steps,
        expected_result: payload.expected_result,
        status: payload.status,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể tạo test case';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const payload = z.object({ id: z.string().uuid(), status: statusSchema }).parse(await req.json());
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('test_cases')
      .update({ status: payload.status, updated_at: new Date().toISOString() })
      .eq('id', payload.id)
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

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json();
    const payload = z.object({
      ids: z.array(z.string().uuid()).min(1),
    }).parse(body);

    const supabase = await createClient();

    // 1. Xóa version history trước (tránh FK constraint)
    const { error: versionError } = await supabase
      .from('test_case_versions')
      .delete()
      .in('test_case_id', payload.ids);

    if (versionError) {
      console.error('[DELETE bulk] Lỗi xóa versions:', versionError.message);
    }

    // 2. Xóa test cases
    const { error } = await supabase
      .from('test_cases')
      .delete()
      .in('id', payload.ids);

    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, deleted: payload.ids.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể xóa test case';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}