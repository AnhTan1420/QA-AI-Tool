// app/api/ai/automation/natural-run/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { buildPrompt, Prompts } from '@/lib/ai/prompts/automation-agent';
import { callAI } from '@/lib/ai/provider'; // hoặc hàm gọi Gemini/Groq của bạn

const NaturalRunSchema = z.object({
  task: z.string().min(1, 'Task description is required'),
  target_url: z.string().url('Must be a valid URL'),
  environment: z.enum(['chromium', 'firefox', 'webkit']).default('chromium'),
  browser_profile_id: z.string().uuid().optional(), // PHẢI có .optional()
  project_id: z.string().uuid().optional(), // nếu cần tạo test case sau run
});

export async function POST(req: NextRequest) {
  try {
    // 1. Parse body
    const body = await req.json();

    // 2. Validate với Zod
    const parsed = NaturalRunSchema.safeParse(body);

    if (!parsed.success) {
      // TRẢ VỀ CHI TIẾT LỖI ĐỂ CLIENT BIẾT
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid input',
          details: parsed.error.flatten().fieldErrors, // Hiện field nào sai
        },
        { status: 400 }
      );
    }

    const { task, target_url, environment, browser_profile_id, project_id } = parsed.data;

    // 3. Auth check
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 4. Build prompt
    const systemPrompt = buildPrompt(Prompts.NATURAL_LANGUAGE_TASK_PROMPT, {
      task,
      target_url,
      start_url: target_url,
      browser: environment,
      is_authenticated: !!browser_profile_id,
      page_type: 'web_application', // hoặc detect từ URL
    });

    // 5. Call AI
    const aiResult = await callAI(systemPrompt);

    // 6. Validate AI output
    const PlanSchema = z.object({
      plan: z.array(z.object({
        step: z.number(),
        action: z.enum(['navigate', 'click', 'fill', 'select', 'assert_visible', 'assert_text', 'assert_url', 'wait', 'scroll', 'upload', 'hover']),
        target: z.string(),
        value: z.string(),
        rationale: z.string(),
        assertion: z.boolean().default(false),
        optional: z.boolean().default(false),
      })),
      test_case_title: z.string(),
      test_case_steps: z.array(z.string()),
      expected_result: z.string(),
      requires_auth: z.boolean(),
      risk_level: z.enum(['low', 'medium', 'high']),
      estimated_steps: z.number(),
      data_dependencies: z.array(z.string()),
    });

    const plan = PlanSchema.parse(aiResult); // Nếu AI trả về không đúng format sẽ throw ở đây

    // 7. Convert plan to Playwright code (gọi Generation Agent)
    const codePrompt = buildPrompt(Prompts.AUTOMATION_GENERATION_PROMPT, {
      title: plan.test_case_title,
      steps: plan.test_case_steps.join('\n'),
      expected_result: plan.expected_result,
      priority: 'medium',
      category: 'positive',
      environment,
      target_url,
      requires_auth: plan.requires_auth,
      cookie_token: '',
      credentials: '',
      has_profile: !!browser_profile_id,
      requirement_description: task,
      document_atoms: '',
    });

    const codeResult = await callAI(codePrompt);
    const code = z.object({
      generated_code: z.string(),
      detected_elements: z.array(z.string()),
      requires_auth: z.boolean(),
      estimated_duration_ms: z.number(),
      resilience_notes: z.array(z.string()).optional(),
    }).parse(codeResult);

    // 8. (Optional) Auto-create test case nếu có project_id
    let createdTestCaseId = null;
    if (project_id) {
      // Lấy default test_case_set hoặc tạo mới
      const { data: testCaseSet } = await supabase
        .from('test_case_sets')
        .select('id')
        .eq('project_id', project_id)
        .limit(1)
        .single();

      if (testCaseSet) {
        const { data: newCase } = await supabase
          .from('test_cases')
          .insert({
            test_case_set_id: testCaseSet.id,
            title: plan.test_case_title,
            steps: plan.test_case_steps.join('\n'),
            expected_result: plan.expected_result,
            priority: 'medium',
            status: 'draft',
            category: 'positive',
            created_by: user.id,
          })
          .select('id')
          .single();

        createdTestCaseId = newCase?.id;
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        plan: plan.plan,
        generated_code: code.generated_code,
        detected_elements: code.detected_elements,
        estimated_duration_ms: code.estimated_duration_ms,
        requires_auth: code.requires_auth,
        test_case_title: plan.test_case_title,
        test_case_id: createdTestCaseId,
      },
    });

  } catch (error: any) {
    console.error('Natural Run API Error:', error);

    // Nếu là ZodError từ AI output
    if (error.name === 'ZodError') {
      return NextResponse.json(
        {
          success: false,
          error: 'AI returned invalid format. Please retry.',
          details: error.flatten?.() ?? error.message,
        },
        { status: 422 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error.message ?? 'Internal server error',
      },
      { status: 500 }
    );
  }
}