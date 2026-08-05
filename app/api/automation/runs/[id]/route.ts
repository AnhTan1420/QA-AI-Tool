import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getSignedScreenshotUrl } from '@/lib/automation/storage';

export const runtime = 'nodejs';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('automation_runs')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ success: false, error: 'Run not found' }, { status: 404 });
  }

  let screenshot_url: string | undefined;
  let annotated_screenshot_url: string | undefined;

  try {
    if (data.screenshot_path) {
      screenshot_url = await getSignedScreenshotUrl(data.screenshot_path);
    }
    if (data.annotated_screenshot_path) {
      annotated_screenshot_url = await getSignedScreenshotUrl(data.annotated_screenshot_path);
    }
  } catch {
    /* signed URLs optional */
  }

  return NextResponse.json({
    success: true,
    data: { ...data, screenshot_url, annotated_screenshot_url },
  });
}
