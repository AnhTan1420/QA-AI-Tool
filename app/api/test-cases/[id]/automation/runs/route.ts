import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const PAGE_SIZE = 20;

/**
 * Lịch sử các lần "Run Automation Test" của 1 test case (bảng automation_runs), mới
 * nhất lên đầu, phân trang (mặc định 20 dòng/lần, dùng ?before=<started_at ISO> để
 * lấy trang kế tiếp - keyset pagination, tránh OFFSET chậm dần khi lịch sử dài).
 *
 * screenshot_url trả về là storage PATH thô (chưa ký) - client không tự render trực
 * tiếp từ đây nữa, mà trỏ <img src> tới GET /api/automation/runs/[runId]/screenshot,
 * route đó mới resign on-demand từng ảnh một cách lazy. Trước đây route này tự
 * Promise.all resign toàn bộ N ảnh trước khi trả JSON, khiến cả danh sách bị chặn lại
 * chờ N request ký URL (network round-trip với Supabase Storage, hoặc dựng lại S3Client
 * cho từng ảnh với R2) - đây là nguyên nhân chính khiến trang load chậm.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const before = req.nextUrl.searchParams.get('before');
  const supabase = await createClient();

  let query = supabase
    .from('automation_runs')
    .select('id, status, duration_ms, screenshot_url, failure_details, started_at, finished_at, profiles(full_name)')
    .eq('test_case_id', id)
    .order('started_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (before) {
    query = query.lt('started_at', before);
  }

  const { data, error } = await query;

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const rows = data ?? [];
  const nextCursor = rows.length === PAGE_SIZE ? rows[rows.length - 1].started_at : null;

  return NextResponse.json({ success: true, data: rows, nextCursor });
}
