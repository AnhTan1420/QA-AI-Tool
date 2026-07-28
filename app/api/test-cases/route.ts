import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const statusSchema = z.enum(['draft', 'in_review', 'approved']);

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get('projectId');

  if (!projectId) {
    return NextResponse.json({ success: false, error: 'Thiếu projectId' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('test_cases')
    .select('*, test_case_sets!inner(project_id)')
    .eq('test_case_sets.project_id', projectId)
    .order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data });
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
