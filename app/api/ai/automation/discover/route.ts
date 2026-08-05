import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { createClient } from '@/lib/supabase/server';
import { discoverRequestSchema } from '@/lib/validators/automation';
import crawlPageForDiscovery from '@/lib/automation/executor';
import { runElementDiscoveryAgent } from '@/lib/automation/agents';

export const maxDuration = 300;
export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const input = discoverRequestSchema.parse(await req.json());
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const { data: member } = await supabase
      .from('project_members')
      .select('user_id')
      .eq('project_id', input.project_id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!member) {
      return NextResponse.json({ success: false, error: 'Not a project member' }, { status: 403 });
    }

    const runId = randomUUID();
    const { domSnapshot, screenshotPath } = await crawlPageForDiscovery(
      input.target_url,
      input.environment,
      runId,
    );

    const screenshotBase64 = (await readFile(screenshotPath)).toString('base64');
    const discovery = await runElementDiscoveryAgent(
      { url: input.target_url, dom_snapshot: domSnapshot },
      screenshotBase64,
    );

    return NextResponse.json({ success: true, data: discovery });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid input' }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Discovery failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
