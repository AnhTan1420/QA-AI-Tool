import { z } from 'zod';

export const testCaseCategorySchema = z.enum([
  'positive',
  'negative',
  'boundary',
  'ui_ux',
  'compatibility',
  'performance',
  'security',
  'integration',
  'regression',
  'accessibility',
  'localization',
]);

export const prioritySchema = z.enum(['P1', 'P2', 'P3', 'P4']);

export const testStepSchema = z.object({
  step_number: z.number().int().positive(),
  action: z.string().min(1),
  expected_result: z.string().min(1),
});

export const generatedTestCaseSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  category: testCaseCategorySchema,
  priority: prioritySchema,
  preconditions: z.array(z.string()).default([]),
  test_data: z.record(z.string()).optional().default({}),
  steps: z.array(testStepSchema).min(1),
  final_expected_result: z.string().min(1),
  source_requirement_ids: z.array(z.string()).optional(),
});

export const generatedTestCasesSchema = z.array(generatedTestCaseSchema).min(1);

export const reviewResultSchema = z.object({
  coverage_score: z.number().min(0).max(100),
  requirement_gaps: z.array(
    z.object({
      requirement_text: z.string().min(1),
      suggested_test_case: generatedTestCaseSchema.optional(),
    }),
  ),
  test_case_comments: z.array(
    z.object({
      test_case_code: z.string().min(1),
      issue_type: z.enum(['missing_step', 'ambiguous_expected', 'duplicate', 'priority_mismatch']),
      comment: z.string().min(1),
    }),
  ),
});

export const generateRequestSchema = z.object({
  requirement_description: z.string().min(20),
  selected_categories: z.array(testCaseCategorySchema).min(1),
  language: z.string().min(2).default('Tiếng Việt'),
  detail_level: z.enum(['concise', 'standard', 'detailed']).default('standard'),
  retrieved_old_test_cases: z.array(generatedTestCaseSchema).optional().default([]),
});

export const reviewRequestSchema = z.object({
  requirement_description: z.string().min(20),
  generated_test_cases: generatedTestCasesSchema,
});

export type TestCaseCategory = z.infer<typeof testCaseCategorySchema>;
export type GeneratedTestCase = z.infer<typeof generatedTestCaseSchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;
