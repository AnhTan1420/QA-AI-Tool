import { z } from 'zod';

const CATEGORY_VALUES = [
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
] as const;

export const testCaseCategorySchema = z.enum(CATEGORY_VALUES);

// AI thinh thoang tra ve nhan hien thi (VD "Functional - Positive") hoac
// khac hoa/thuong/dau cach thay vi dung enum slug. Preprocess nay chi ap
// dung khi parse OUTPUT tu AI (generatedTestCaseSchema) - KHONG anh huong
// validate input tu client (generateRequestSchema van dung testCaseCategorySchema goc).
function normalizeCategoryValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[\s\-/]+/g, '_')
    .replace(/_+/g, '_');

  if ((CATEGORY_VALUES as readonly string[]).includes(slug)) return slug;

  const aliasMap: Record<string, (typeof CATEGORY_VALUES)[number]> = {
    functional_positive: 'positive',
    happy_path: 'positive',
    functional_negative: 'negative',
    edge_case: 'boundary',
    boundary_edge_case: 'boundary',
    ui_ux_validation: 'ui_ux',
    uiux: 'ui_ux',
    integration_api: 'integration',
    api: 'integration',
  };
  return aliasMap[slug] ?? value;
}

const lenientCategorySchema = z.preprocess(normalizeCategoryValue, testCaseCategorySchema);

export const prioritySchema = z.enum(['P1', 'P2', 'P3', 'P4']);

// Chap nhan "p1"/"P1 "/1 (number) ... va chuan hoa ve "P1".."P4".
function normalizePriorityValue(value: unknown): unknown {
  if (typeof value === 'number' && value >= 1 && value <= 4) return `P${value}`;
  if (typeof value !== 'string') return value;
  const trimmed = value.trim().toUpperCase();
  if (/^P[1-4]$/.test(trimmed)) return trimmed;
  if (/^[1-4]$/.test(trimmed)) return `P${trimmed}`;
  return value;
}

const lenientPrioritySchema = z.preprocess(normalizePriorityValue, prioritySchema);

export const testStepSchema = z.object({
  // AI doi khi tra step_number dang string ("1") -> coerce ve number.
  step_number: z.coerce.number().int().positive(),
  action: z.string().min(1),
  expected_result: z.string().min(1),
});

// ── Schema "khoan dung" danh rieng cho retrieved_old_test_cases (RAG context) ──
// Day la du lieu tham khao do nguoi dung tu import (thuong tu file Excel cu, hay
// bi thieu expected_result/title/code o tung step vi ho chi dien Final Expected
// Result). Khac voi generatedTestCaseSchema (dung de ep chat luong OUTPUT cua AI),
// schema nay KHONG duoc phep quang mot request generate hop le chi vi du lieu RAG
// tham khao co field rong - nen thay vi .min(1) reject, ta fill fallback truoc khi validate.
function emptyStringToFallback(fallback: string) {
  return (value: unknown) => {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'string' && value.trim() === '') return fallback;
    return value;
  };
}

const lenientTestStepSchema = z.object({
  step_number: z.coerce.number().int().positive().catch(1),
  action: z.preprocess(emptyStringToFallback('N/A'), z.string().min(1)),
  expected_result: z.preprocess(emptyStringToFallback('N/A'), z.string().min(1)),
});

// test_data phai la Record<string, string>, nhung AI hay chen number/boolean
// (VD { "so_luong": 5 }) -> ep cac gia tri primitive ve string truoc khi validate,
// object/array long thi JSON.stringify de khong mat du lieu va van la string.
function normalizeTestDataValue(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  const entries = Object.entries(value as Record<string, unknown>).map(([k, v]) => {
    if (typeof v === 'string') return [k, v];
    if (typeof v === 'number' || typeof v === 'boolean') return [k, String(v)];
    if (v === null || v === undefined) return [k, ''];
    return [k, JSON.stringify(v)];
  });
  return Object.fromEntries(entries);
}

const lenientTestDataSchema = z.preprocess(normalizeTestDataValue, z.record(z.string()));

export const generatedTestCaseSchema = z.object({
  code: z.string().min(1),
  title: z.string().min(1),
  category: lenientCategorySchema,
  priority: lenientPrioritySchema,
  preconditions: z.array(z.string()).default([]),
  test_data: lenientTestDataSchema.optional().default({}),
  steps: z.array(testStepSchema).min(1),
  final_expected_result: z.string().min(1),
  source_requirement_ids: z.array(z.string()).optional(),
});

export const generatedTestCasesSchema = z.array(generatedTestCaseSchema).min(1);

// Test case "cu" duoc client gui len de lam RAG context (khong phai output AI can
// validate chat luong) - dung lenientTestStepSchema + fallback cho code/title/
// final_expected_result de tranh reject ca request chi vi vai field rong trong
// file Excel import (rat pho bien, vi user thuong chi dien Final Expected Result).
export const retrievedTestCaseSchema = z.object({
  code: z.preprocess(emptyStringToFallback('TC-OLD'), z.string().min(1)),
  title: z.preprocess(emptyStringToFallback('Untitled test case'), z.string().min(1)),
  category: lenientCategorySchema,
  priority: lenientPrioritySchema,
  preconditions: z.array(z.string()).default([]),
  test_data: lenientTestDataSchema.optional().default({}),
  steps: z
    .array(lenientTestStepSchema)
    .default([{ step_number: 1, action: 'N/A', expected_result: 'N/A' }]),
  final_expected_result: z.preprocess(emptyStringToFallback('N/A'), z.string().min(1)),
  source_requirement_ids: z.array(z.string()).optional(),
});

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
  retrieved_old_test_cases: z.array(retrievedTestCaseSchema).optional().default([]),
});

export const reviewRequestSchema = z.object({
  requirement_description: z.string().min(20),
  generated_test_cases: generatedTestCasesSchema,
});

export type TestCaseCategory = z.infer<typeof testCaseCategorySchema>;
export type GeneratedTestCase = z.infer<typeof generatedTestCaseSchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;
