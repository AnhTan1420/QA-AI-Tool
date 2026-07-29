import type { getDictionary } from '@/lib/i18n/dictionaries';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import * as XLSX from 'xlsx';

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
    .order('code', { ascending: true });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  if (!data || data.length === 0) {
    return NextResponse.json({ success: false, error: 'Không có test case nào để export' }, { status: 404 });
  }

  const rows = data.map((tc: any) => {
    const stepsText = (tc.steps || [])
      .map((s: any) => `${s.step_number}. ${s.action}\nExpected: ${s.expected_result}`)
      .join('\n\n');

    const preconditionsText = (tc.preconditions || []).join('\n');
    const testDataText = Object.entries(tc.test_data || {})
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

    return {
      'Mã': tc.code,
      'Tiêu đề': tc.title,
      'Phân loại': tc.category,
      'Mức độ ưu tiên': tc.priority,
      'Điều kiện tiên quyết': preconditionsText,
      'Dữ liệu test': testDataText,
      'Các bước thực hiện': stepsText,
      'Kết quả mong đợi': tc.expected_result,
      'Trạng thái': tc.status,
      'Ngày tạo': tc.created_at,
      'Cập nhật lần cuối': tc.updated_at,
    };
  });

  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Test Cases');

  const colWidths = [
    { wch: 15 }, { wch: 40 }, { wch: 15 }, { wch: 10 },
    { wch: 35 }, { wch: 30 }, { wch: 60 }, { wch: 40 },
    { wch: 12 }, { wch: 20 }, { wch: 20 },
  ];
  ws['!cols'] = colWidths;

  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="test-cases-${projectId.slice(0, 8)}.xlsx"`,
    },
  });
}