// app/api/ai/automation/natural-run/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { runNaturalLanguageTaskAgent, runPlaywrightGenerationAgent } from '@/lib/automation/agents';
import { NaturalLanguagePlanSchema } from '@/lib/validators/automation';

const NaturalRunSchema = z.object({
  task: z.string().min(1, 'Task description is required'),
  target_url: z.string().url('Must be a valid URL'),
  environment: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
  browser_profile_id: z.string().uuid().optional(),
  project_id: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = NaturalRunSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: parsed.error.flatten().fieldErrors,
        },
        { status: 400 }
      );
    }

    const { task, target_url, environment, browser_profile_id, project_id } = parsed.data;

    // Auth check
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }

    // Step 1: AI plans the task
    const plan = await runNaturalLanguageTaskAgent({
      task,
      target_url,
      browser: environment,
    });

    // Validate plan structure (extra safety)
    NaturalLanguagePlanSchema.parse(plan);

    // Step 2: Generate Playwright code from the plan
    const codeResult = await runPlaywrightGenerationAgent({
      title: plan.test_case_title || task,
      steps: (plan.test_case_steps || []).join('\n'),
      expected_result: plan.expected_result || '',
      priority: 'medium',
      category: 'positive',
      environment,
      target_url,
      requires_auth: plan.requires_auth || false,
      has_profile: !!browser_profile_id,
      requirement_description: task,
    });

    // Step 3: Auto-create test case draft if project_id provided
    let testCaseId: string | null = null;
    if (project_id) {
      const { data: testCaseSet, error: setError } = await supabase
        .from('test_case_sets')
        .select('id')
        .eq('project_id', project_id)
        .limit(1)
        .maybeSingle();

      if (setError) console.warn('Failed to fetch test_case_set:', setError);

      if (testCaseSet?.id) {
        const { data: newCase, error: caseError } = await supabase
          .from('test_cases')
          .insert({
            test_case_set_id: testCaseSet.id,
            title: plan.test_case_title || task,
            steps: (plan.test_case_steps || []).join('\n'),
            expected_result: plan.expected_result || '',
            priority: 'medium',
            status: 'draft',
            category: 'positive',
            created_by: user.id,
          })
          .select('id')
          .single();

        if (caseError) {
          console.warn('Auto-create test case failed:', caseError);
        } else {
          testCaseId = newCase.id;
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        plan: plan.plan,
        generated_code: codeResult.generated_code,
        detected_elements: codeResult.detected_elements,
        estimated_duration_ms: codeResult.estimated_duration_ms,
        requires_auth: codeResult.requires_auth,
        test_case_title: plan.test_case_title || task,
        test_case_id: testCaseId,
      },
    });
  } catch (error: any) {
    console.error('Natural Run API Error:', error);

    // Friendly error for Zod/AI parse failures
    if (error.name === 'ZodError' || error?.issues) {
      return NextResponse.json(
        {
          success: false,
          error: 'AI returned invalid data. Please retry or simplify your task description.',
          details: error.flatten?.() ?? error.message,
        },
        { status: 422 }
      );
    }

    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}