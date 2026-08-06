import { NextRequest, NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { randomUUID } from 'crypto';
import { createClient } from '@/lib/supabase/server';
import { runAutomationSchema } from '@/lib/validators/automation';
import {
  fetchScriptById,
  fetchBrowserProfileStorage,
} from '@/lib/automation/db-helpers';
import { decryptCredentials, decryptSecret } from '@/lib/automation/encryption';
import { executeAutomationRun, type BrowserEnv } from '@/lib/automation/executor';
import { uploadAutomationScreenshot } from '@/lib/automation/storage';
import { readFile } from 'fs/promises';

export const maxDuration = 300;
export const runtime = 'nodejs';

async function executeAndPersist(
  scriptId: string,
  userId: string,
  browser: BrowserEnv,
  timeoutSeconds: number,
) {
  const supabase = await createClient();
  const fetched = await fetchScriptById(scriptId, true);
  if (!fetched.data) {
    throw new Error(fetched.error ?? 'Script not found');
  }

  const { script, projectId } = fetched.data;
  const runId = randomUUID();

  const { data: runRecord } = await supabase
    .from('automation_runs')
    .insert({
      id: runId,
      script_id: scriptId,
      status: 'running',
      created_by: userId,
    })
    .select()
    .single();

  // FIX: credentials có thể là object hoặc string (encrypted JSON)
  let credentials: { username: string; password: string } | undefined = undefined;
  
  if (script.credentials) {
    // Nếu credentials là string (encrypted) hoặc object đã encrypt
    const raw = script.credentials;
    if (typeof raw === 'string') {
      try {
        credentials = decryptCredentials(raw);
      } catch {
        /* ignore invalid encrypted string */
      }
    } else if (raw && typeof raw === 'object' && raw.password) {
      // Nếu là object nhưng password có vẻ đã encrypt (base64-like hoặc dài)
      const pwd = raw.password as string;
      if (pwd.startsWith('ey') || pwd.length > 50) {
        try {
          credentials = decryptCredentials(raw as any);
        } catch {
          credentials = raw as { username: string; password: string };
        }
      } else {
        credentials = raw as { username: string; password: string };
      }
    }
  }

  let cookieToken: string | undefined;
  if (script.cookie_token && script.cookie_token !== '***') {
    try {
      cookieToken = decryptSecret(script.cookie_token);
    } catch {
      cookieToken = script.cookie_token;
    }
  }

  let profileStorageState: string | undefined;
  if (script.browser_profile_id) {
    profileStorageState = await fetchBrowserProfileStorage(script.browser_profile_id);
  }

  const { data: tc } = await supabase
    .from('test_cases')
    .select('title, expected_result')
    .eq('id', script.test_case_id)
    .maybeSingle();

  const result = await executeAutomationRun({
    runId,
    code: script.generated_code,
    environment: browser,
    timeout: timeoutSeconds,
    credentials,
    cookieToken,
    profileStorageState,
    testTitle: tc?.title,
    expectedResult: tc?.expected_result,
    targetUrl: script.target_url,
    baselineScreenshotPath: script.baseline_screenshot_path ?? undefined,
    projectId,
  });

  let screenshot_path: string | null = null;
  let annotated_screenshot_path: string | null = null;

  if (result.screenshotPath) {
    screenshot_path = await uploadAutomationScreenshot(projectId, runId, 'screenshot.png', result.screenshotPath);
  }
  if (result.annotatedScreenshotPath) {
    annotated_screenshot_path = await uploadAutomationScreenshot(
      projectId,
      runId,
      'annotated.png',
      result.annotatedScreenshotPath,
    );
  }

  if (result.status === 'passed' && !script.baseline_screenshot_path && result.screenshotPath) {
    await supabase
      .from('automation_scripts')
      .update({ baseline_screenshot_path: screenshot_path, status: 'verified' })
      .eq('id', scriptId);
  }

  if (result.healing_log) {
    await supabase.from('automation_healing_logs').insert({
      run_id: runId,
      script_id: scriptId,
      failed_selector: result.healing_log.original_selector,
      healed_selector: result.healing_log.healed_selector,
      healing_confidence: result.healing_log.confidence,
      screenshot_path: screenshot_path,
      applied: false,
    });
  }

  const { data: updated } = await supabase
    .from('automation_runs')
    .update({
      status: result.status,
      execution_log: result.execution_log,
      screenshot_path,
      annotated_screenshot_path,
      bug_analysis: result.bug_analysis ?? null,
      visual_regression_score: result.visual_regression_score ?? null,
      healing_log: result.healing_log ?? null,
      duration_ms: result.duration_ms,
    })
    .eq('id', runId)
    .select()
    .single();

  return { run: updated ?? runRecord, browser, screenshot_path };
}

export async function GET(req: NextRequest) {
  const scriptId = req.nextUrl.searchParams.get('script_id');
  const page = parseInt(req.nextUrl.searchParams.get('page') ?? '1', 10);
  const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '10', 10);
  const offset = (page - 1) * limit;

  if (!scriptId) {
    return NextResponse.json({ success: false, error: 'script_id required' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error, count } = await supabase
    .from('automation_runs')
    .select('*', { count: 'exact' })
    .eq('script_id', scriptId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: { runs: data, page, limit, total: count ?? 0 } });
}

export async function POST(req: Request) {
  try {
    const input = runAutomationSchema.parse(await req.json());
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const browsers = input.browsers?.length
      ? input.browsers
      : [((await fetchScriptById(input.script_id)).data?.script.environment ?? 'chromium') as BrowserEnv];

    if (browsers.length > 1) {
      const results = await Promise.all(
        browsers.map((b) => executeAndPersist(input.script_id, user.id, b, input.timeout_seconds)),
      );

      const browser_results = results.map((r) => ({
        browser: r.browser,
        status: r.run?.status ?? 'error',
        screenshot_path: r.screenshot_path ?? undefined,
      }));

      const primary = results[0]?.run;
      if (primary) {
        await supabase
          .from('automation_runs')
          .update({ browser_results })
          .eq('id', primary.id);
      }

      return NextResponse.json({
        success: true,
        data: { run: { ...primary, browser_results }, browser_results },
      });
    }

    const result = await executeAndPersist(
      input.script_id,
      user.id,
      browsers[0],
      input.timeout_seconds,
    );

    return NextResponse.json({ success: true, data: { run: result.run } });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json({ success: false, error: 'Invalid input' }, { status: 400 });
    }
    const message = error instanceof Error ? error.message : 'Run failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
