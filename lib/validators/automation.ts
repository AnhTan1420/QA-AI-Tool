import { z } from 'zod';

export const browserEnvironmentSchema = z.enum(['chromium', 'firefox', 'webkit']);

export const generateAutomationRequestSchema = z.object({
  test_case_id: z.string().uuid(),
  environment: browserEnvironmentSchema,
  target_url: z.string().url(),
  cookie_token: z.string().optional(),
  credentials: z.object({ username: z.string(), password: z.string() }).optional(),
  browser_profile_id: z.string().uuid().optional(),
  language: z.enum(['English', 'Vietnamese']).default('English'),
});

export const saveAutomationScriptSchema = z.object({
  test_case_id: z.string().uuid(),
  test_case_set_id: z.string().uuid(),
  environment: browserEnvironmentSchema,
  target_url: z.string().url(),
  cookie_token: z.string().optional(),
  credentials: z.object({ username: z.string(), password: z.string() }).optional(),
  browser_profile_id: z.string().uuid().optional(),
  generated_code: z.string().min(1),
  status: z.enum(['draft', 'generated', 'verified', 'deprecated']).default('generated'),
});

export const runAutomationSchema = z.object({
  script_id: z.string().uuid(),
  timeout_seconds: z.number().min(5).max(300).default(60),
  browsers: z.array(browserEnvironmentSchema).optional(),
});

export const naturalRunRequestSchema = z.object({
  task: z.string().min(5),
  target_url: z.string().url(),
  project_id: z.string().uuid(),
  environment: browserEnvironmentSchema.default('chromium'),
  browser_profile_id: z.string().uuid().optional(),
});

export const discoverRequestSchema = z.object({
  target_url: z.string().url(),
  project_id: z.string().uuid(),
  environment: browserEnvironmentSchema.default('chromium'),
});

export const browserProfileRequestSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1),
  description: z.string().optional(),
  login_script: z.string().optional(),
  storage_state_json: z.string().optional(),
});

export const patchAutomationScriptSchema = z.object({
  generated_code: z.string().min(1).optional(),
  status: z.enum(['draft', 'generated', 'verified', 'deprecated']).optional(),
  target_url: z.string().url().optional(),
  environment: browserEnvironmentSchema.optional(),
  change_summary: z.string().optional(),
});

export const AutomationScriptSchema = z.object({
  id: z.string().uuid(),
  test_case_id: z.string().uuid(),
  test_case_set_id: z.string().uuid(),
  browser_profile_id: z.string().uuid().optional().nullable(),
  environment: browserEnvironmentSchema,
  target_url: z.string().url(),
  cookie_token: z.string().optional().nullable(),
  credentials: z.object({ username: z.string(), password: z.string() }).optional().nullable(),
  generated_code: z.string().min(1),
  status: z.enum(['draft', 'generated', 'verified', 'deprecated']),
  baseline_screenshot_path: z.string().optional().nullable(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const BugAnalysisSchema = z.object({
  failed_element: z.object({
    selector: z.string(),
    description: z.string(),
    location_hint: z.string(),
  }),
  bug_type: z.enum(['element_not_found', 'wrong_text', 'wrong_state', 'visual_regression', 'timeout', 'other']),
  expected_vs_actual: z.object({ expected: z.string(), actual: z.string() }),
  visual_analysis: z.string(),
  suggested_fix: z.string(),
  severity: z.enum(['critical', 'major', 'minor']),
  annotation_coordinates: z
    .object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
    .optional(),
});

export const AutomationRunSchema = z.object({
  id: z.string().uuid(),
  script_id: z.string().uuid(),
  status: z.enum(['running', 'passed', 'failed', 'error', 'timeout']),
  execution_log: z.string().optional().nullable(),
  screenshot_path: z.string().optional().nullable(),
  annotated_screenshot_path: z.string().optional().nullable(),
  bug_analysis: BugAnalysisSchema.optional().nullable(),
  visual_regression_score: z.number().optional().nullable(),
  healing_log: z
    .object({
      original_selector: z.string(),
      healed_selector: z.string(),
      confidence: z.number(),
      retried: z.boolean(),
    })
    .optional()
    .nullable(),
  browser_results: z
    .array(
      z.object({
        browser: browserEnvironmentSchema,
        status: z.string(),
        screenshot_path: z.string().optional(),
      }),
    )
    .optional()
    .nullable(),
  duration_ms: z.number().optional().nullable(),
  created_at: z.string(),
});

export const GenerateAutomationResponseSchema = z.object({
  generated_code: z.string(),
  detected_elements: z.array(z.string()),
  requires_auth: z.boolean(),
  estimated_duration_ms: z.number(),
});

export const SelfHealingResponseSchema = z.object({
  healed_selector: z.string(),
  confidence: z.number(),
  reasoning: z.string(),
  alternative_selectors: z.array(z.string()),
  requires_human_review: z.boolean(),
});

export const VisualRegressionResponseSchema = z.object({
  visual_diff_score: z.number(),
  changes: z.array(
    z.object({
      category: z.enum(['layout_shift', 'color_change', 'missing_element', 'text_change', 'new_element']),
      description: z.string(),
      severity: z.enum(['critical', 'major', 'minor']),
      region: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
    }),
  ),
  summary: z.string(),
});

export const NaturalLanguagePlanSchema = z.object({
  plan: z.array(
    z.object({
      step: z.number(),
      action: z.enum(['navigate', 'click', 'fill', 'select', 'assert', 'wait']),
      target: z.string(),
      value: z.string(),
      rationale: z.string(),
    }),
  ),
  test_case_title: z.string(),
  test_case_steps: z.array(z.string()),
  expected_result: z.string(),
  requires_auth: z.boolean(),
  risk_level: z.enum(['low', 'medium', 'high']),
});

export const ElementDiscoveryResponseSchema = z.object({
  suggested_test_cases: z.array(
    z.object({
      title: z.string(),
      category: z.enum(['positive', 'negative', 'boundary', 'ui']),
      priority: z.enum(['high', 'medium', 'low']),
      steps: z.array(z.string()),
      expected_result: z.string(),
      target_elements: z.array(z.string()),
      risk: z.string(),
    }),
  ),
  detected_patterns: z.array(z.string()),
  coverage_gaps: z.array(z.string()),
});

export const BrowserProfileSchema = z.object({
  id: z.string().uuid(),
  project_id: z.string().uuid(),
  name: z.string(),
  storage_state: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  created_by: z.string().uuid(),
  created_at: z.string(),
});
