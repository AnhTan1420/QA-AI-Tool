// app/api/ai/automation/generate/route.ts
// FIX: credentials phải JSON.stringify vì AutomationGenerationInput expect string

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { runPlaywrightGenerationAgent } from '@/lib/automation/agents';

const GenerateSchema = z.object({
  test_case_id: z.string().uuid(),
  environment: z.enum(['chromium', 'firefox', 'webkit']),
  target_url: z.string().url(),
  cookie_token: z.string().optional(),
  credentials: z.object({ username: z.string(), password: z.string() }).optional(),
  browser_profile_id: z.string().uuid().optional(),
  language: z.enum(['English', 'Vietnamese']).default('English'),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = GenerateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: 'Invalid input', details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });

    const input = parsed.data;

    // Fetch test case + requirement
    const { data: testCase, error: tcError } = await supabase
      .from('test_cases')
      .select('*, test_case_sets!inner(*)')
      .eq('id', input.test_case_id)
      .single();

    if (tcError || !testCase) {
      return NextResponse.json({ success: false, error: 'Test case not found' }, { status: 404 });
    }

    const result = await runPlaywrightGenerationAgent({
      title: testCase.title,
      steps: testCase.steps,
      expected_result: testCase.expected_result,
      priority: testCase.priority,
      category: testCase.category,
      environment: input.environment,
      target_url: input.target_url,
      requires_auth: Boolean(input.credentials || input.cookie_token || input.browser_profile_id),
      cookie_token: input.cookie_token,
      credentials: input.credentials ? JSON.stringify(input.credentials) : undefined, // ← FIX
      has_profile: !!input.browser_profile_id,
      requirement_description: testCase.test_case_sets?.requirement_description || '',
      document_atoms: '',
    });

    return NextResponse.json({ success: true, data: result });
  } catch (error: any) {
    console.error('Generate API Error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
