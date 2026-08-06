import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { discoverRequestSchema } from '@/lib/validators/automation';
import { crawlPageForDiscovery } from '@/lib/automation/executor';
import { runElementDiscoveryAgent } from '@/lib/automation/agents';

export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = discoverRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const { target_url, environment } = parsed.data;
    const crawlResult = await crawlPageForDiscovery(target_url, environment);
    
    // ← FIX: Đảm bảo screenshot là string base64 (dù executor đã trả về string, đây là double-check)
    const screenshotBase64 = typeof crawlResult.screenshot === 'string'
      ? crawlResult.screenshot
      : (crawlResult.screenshot as Buffer).toString('base64');

    const discoveryResult = await runElementDiscoveryAgent(
      { url: crawlResult.url, dom_snapshot: JSON.stringify(crawlResult.domSnapshot).slice(0, 8000), page_purpose: 'web_application' },
      screenshotBase64
    );

    return NextResponse.json({ success: true, data: discoveryResult });
  } catch (error: any) {
    console.error('Discovery API Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
