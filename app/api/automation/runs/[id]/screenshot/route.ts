import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const type = req.nextUrl.searchParams.get('type') ?? 'original';
  const supabase = await createClient();

  const { data: run } = await supabase
    .from('automation_runs')
    .select('screenshot_path, annotated_screenshot_path')
    .eq('id', id)
    .maybeSingle();

  if (!run) {
    return NextResponse.json({ success: false, error: 'Run not found' }, { status: 404 });
  }

  const path = type === 'annotated' ? run.annotated_screenshot_path : run.screenshot_path;
  if (!path) {
    return NextResponse.json({ success: false, error: 'Screenshot not available' }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from('automation-screenshots').download(path);

  if (error || !data) {
    return NextResponse.json({ success: false, error: error?.message ?? 'Download failed' }, { status: 500 });
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'private, max-age=3600',
    },
  });
}
