import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { resignScreenshotUrl } from '@/lib/automation/screenshot-storage';

/**
 * Lịch sử các lần "Run Automation Test" của 1 test case (bảng automation_runs), mới
 * nhất lên đầu. screenshot_url được lưu dưới dạng storage PATH (bucket private) - route
 * này ký lại (re-sign) thành URL có thể xem trước khi trả về client, vì signed URL cũ
 * (tạo lúc chạy, xem app/api/automation/run/route.ts) có thể đã hết hạn.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('automation_runs')
    .select('id, status, duration_ms, screenshot_url, failure_details, started_at, finished_at, profiles(full_name)')
    .eq('test_case_id', id)
    .order('started_at', { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  const withSignedUrls = await Promise.all(
    (data ?? []).map(async (run) => ({
      ...run,
      screenshot_url: run.screenshot_url ? await resignScreenshotUrl(supabase, run.screenshot_url) : null,
    })),
  );

  return NextResponse.json({ success: true, data: withSignedUrls });
}
