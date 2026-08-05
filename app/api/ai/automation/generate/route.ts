import { NextResponse } from 'next/server';
import { ZodError } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { generateAutomationRequestSchema } from '@/lib/validators/automation';
import { runPlaywrightGenerationAgent } from '@/lib/automation/agents';
import { fetchTestCaseWithContext } from '@/lib/automation/db-helpers';

export const maxDuration = 300;
export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const input = generateAutomationRequestSchema.parse(await req.json());
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    const tc = await fetchTestCaseWithContext(input.test_case_id);
    if (!tc) {
      return NextResponse.json({ success: false, error: 'Test case not found' }, { status: 404 });
    }

    const sets = tc.test_case_sets as {
      id: string;
      project_id: string;
      requirements?: { description?: string } | null;
    };

    const stepsText = (tc.steps as { step_number: number; action: string; expected_result: string }[])
      .map((s) => `${s.step_number}. ${s.action} → ${s.expected_result}`)
      .join('\n');

    const result = await runPlaywrightGenerationAgent({
      title: tc.title,
      steps: stepsText,
      expected_result: tc.expected_result ?? '',
      priority: tc.priority,
      category: tc.category,
      environment: input.environment,
      target_url: input.target_url,
      requires_auth: Boolean(input.credentials || input.cookie_token || input.browser_profile_id),
      cookie_token: input.cookie_token,
      credentials: input.credentials,
      requirement_description: sets.requirements?.description,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    if (error instanceof ZodError) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: error.issues },
        { status: 400 },
      );
    }
    const message = error instanceof Error ? error.message : 'Generation failed';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
