import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/services/supabase/server';
import { resignRunArtifactUrl } from '@/services/automation/run-artifact-storage';

const PAGE_SIZE = 20;

/**
 * Lịch sử các lần "Run Automation Test" của 1 test case (bảng automation_runs), mới
 * nhất lên đầu, phân trang (mặc định 20 dòng/lần, dùng ?before=<started_at ISO> để
 * lấy trang kế tiếp - keyset pagination, tránh OFFSET chậm dần khi lịch sử dài).
 *
 * screenshot_url/video_url/html_report_url trả về là storage PATH thô (chưa ký) -
 * client không tự render trực tiếp từ đây, mà trỏ tới các route
 * GET /api/automation/runs/[runId]/{screenshot,video,html-report}, route đó mới
 * resign on-demand từng artifact một cách lazy khi thực sự được click - một normal
 * top-level navigation (thẻ <a>) vẫn gửi kèm cookie nên route đó check quyền được
 * bình thường qua RLS.
 *
 * trace_url là NGOẠI LỆ duy nhất: nó luôn được resign NGAY tại đây thành 1 link
 * trace.playwright.dev đầy đủ (không phải path thô) - vì trace.playwright.dev tự
 * fetch() file trace bằng JS phía client (cross-origin, KHÔNG gửi kèm cookie của
 * QAJD), nên không thể dùng route redirect lazy như 3 loại kia (route đó cần cookie
 * để authenticate qua RLS). Chi phí resign sớm chấp nhận được vì trace_url chỉ tồn
 * tại ở số ít run self-hosted failed/flaky, không phải mọi dòng trong danh sách.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const before = req.nextUrl.searchParams.get('before');
  const supabase = await createClient();

  let query = supabase
    .from('automation_runs')
    .select(
      'id, status, duration_ms, attempts, is_flaky, execution_mode, screenshot_url, video_url, html_report_url, trace_url, failure_details, started_at, finished_at, profiles(full_name)',
    )
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

  const withTraceLinks = await Promise.all(
    rows.map(async (row) => {
      if (!row.trace_url) return { ...row, trace_playwright_dev_url: null };
      const signed = await resignRunArtifactUrl(supabase, row.trace_url);
      return {
        ...row,
        trace_playwright_dev_url: signed ? `https://trace.playwright.dev/?trace=${encodeURIComponent(signed)}` : null,
      };
    }),
  );

  return NextResponse.json({ success: true, data: withTraceLinks, nextCursor });
}
