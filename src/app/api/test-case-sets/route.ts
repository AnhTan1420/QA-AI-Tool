import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/services/supabase/server';

const createSetSchema = z.object({
  project_id: z.string().uuid(),
  requirement_title: z.string().min(1).default('Requirement'),
  requirement_description: z.string().min(10),
  generated_by_model: z.string().optional(),
  // PHASE 0 "analysis" cua Generation Agent (xem generationAnalysisSchema trong
  // lib/validators/test-case.ts) - optional/khong .strict() vi la du lieu audit-trail,
  // khong phai dieu kien de tao set thanh cong.
  analysis: z.record(z.any()).nullish(),
});

/**
 * Tao 1 requirement + 1 test_case_set trong cung mot request - la buoc "khoi tao"
 * bat buoc truoc khi co the luu test case vao thu vien (bang test_cases chi lien ket
 * qua set_id, khong co project_id truc tiep - dung nhu schema.sql).
 * Tra ve set_id de client goi tiep /api/test-cases/bulk.
 */
export async function POST(req: NextRequest) {
  try {
    const payload = createSetSchema.parse(await req.json());
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

    const { data: requirement, error: requirementError } = await supabase
      .from('requirements')
      .insert({
        project_id: payload.project_id,
        title: payload.requirement_title,
        description: payload.requirement_description,
        created_by: user.id,
      })
      .select()
      .single();

    if (requirementError) {
      return NextResponse.json({ success: false, error: requirementError.message }, { status: 500 });
    }

    const { data: set, error: setError } = await supabase
      .from('test_case_sets')
      .insert({
        project_id: payload.project_id,
        requirement_id: requirement.id,
        status: 'generated',
        generated_by_model: payload.generated_by_model ?? null,
        analysis: payload.analysis ?? null,
        created_by: user.id,
      })
      .select()
      .single();

    if (setError) {
      return NextResponse.json({ success: false, error: setError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, data: { requirement, set } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Không thể tạo test case set';
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}