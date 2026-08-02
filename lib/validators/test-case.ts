import { z } from 'zod';
import { parsedDocumentSchema } from './document';

export const CATEGORY_VALUES = [
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

export const prioritySchema = z.enum(['Critical', 'Major', 'Normal']);

// Chap nhan cac bien the cu/thang do khac (P1-P4, so, Blocker/High/Medium/Low...)
// va chuan hoa ve 3 muc: Critical | Major | Normal.
// Mapping tu thang P1-P4 cu: P1 -> Critical, P2 -> Major, P3/P4 -> Normal.
function normalizePriorityValue(value: unknown): unknown {
  if (typeof value === 'number') {
    if (value === 1) return 'Critical';
    if (value === 2) return 'Major';
    if (value >= 3) return 'Normal';
    return value;
  }
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  const upper = trimmed.toUpperCase();

  if (upper === 'CRITICAL') return 'Critical';
  if (upper === 'MAJOR') return 'Major';
  if (upper === 'NORMAL') return 'Normal';

  const legacyMap: Record<string, 'Critical' | 'Major' | 'Normal'> = {
    P1: 'Critical',
    P2: 'Major',
    P3: 'Normal',
    P4: 'Normal',
    '1': 'Critical',
    '2': 'Major',
    '3': 'Normal',
    '4': 'Normal',
    BLOCKER: 'Critical',
    HIGH: 'Critical',
    MEDIUM: 'Major',
    LOW: 'Normal',
    MINOR: 'Normal',
    TRIVIAL: 'Normal',
  };
  return legacyMap[upper] ?? value;
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

// Cac field o duoi day (dimension_scores, severity, dimension, summary) DA duoc
// review-agent.ts yeu cau AI sinh ra tu truoc, nhung schema cu KHONG khai bao nen
// Zod (che do "strip" mac dinh) am tham vut bo ngay khi parse - AI van tra tien
// token de tinh 12 diem theo dimension + severity tung gap/comment + tom tat, ma
// khong noi nao trong app doc lai duoc. Fix: khai bao de giu lai + hien thi o UI
// (xem review-panel.tsx) va luu vao ai_reviews.review_payload.
// Tat ca deu .optional() (khong .min(1)/khong bat buoc) vi runAIAgent('review')
// KHONG dung Gemini responseSchema (chi tac vu 'generation' co) - review hoan
// toan dua vao prompt text, nen neu model bo sot 1 field o day thi request van
// khong nen fail (giu nguyen hanh vi cu, chi "nang cap" chu khong "sua nghiem").
const severitySchema = z.enum(['Critical', 'Major', 'Minor']);

const dimensionScoresSchema = z
  .object({
    functional_positive: z.number().min(0).max(100),
    functional_negative: z.number().min(0).max(100),
    boundary_edge: z.number().min(0).max(100),
    state_transition: z.number().min(0).max(100),
    security: z.number().min(0).max(100),
    performance: z.number().min(0).max(100),
    compatibility: z.number().min(0).max(100),
    integration: z.number().min(0).max(100),
    regression: z.number().min(0).max(100),
    accessibility: z.number().min(0).max(100),
    localization: z.number().min(0).max(100),
    audit_compliance: z.number().min(0).max(100),
  })
  .partial();

export const reviewResultSchema = z.object({
  coverage_score: z.number().min(0).max(100),
  summary: z.string().optional(),
  dimension_scores: dimensionScoresSchema.optional(),
  requirement_gaps: z.array(
    z.object({
      requirement_text: z.string().min(1),
      severity: severitySchema.optional(),
      dimension: z.string().optional(),
      suggested_test_case: generatedTestCaseSchema.optional(),
    }),
  ),
  test_case_comments: z.array(
    z.object({
      test_case_code: z.string().min(1),
      issue_type: z.enum(['missing_step', 'ambiguous_expected', 'duplicate', 'priority_mismatch']),
      severity: severitySchema.optional(),
      comment: z.string().min(1),
    }),
  ),
});

export type ReviewSeverity = z.infer<typeof severitySchema>;
export type DimensionScores = z.infer<typeof dimensionScoresSchema>;

// generationAnalysisSchema — validate PHASE 0 "analysis" tu Generation Agent (xem
// lib/ai/prompts/generation-agent.ts + generation-response-schema.ts). Truoc day
// object nay duoc AI sinh ra (ton token that su - day la phan CHI TIET NHAT trong
// ca response) roi bi vut bo hoan toan sau khi validate test_cases (khong tra ve
// client, khong luu DB, khong hien thi o dau). Gio duoc giu lai de:
//   1) Luu vao test_case_sets.analysis (audit lai sau, xem vi sao AI ra quyet dinh do)
//   2) Hien thi 1 phan "AI Reasoning" cho QA xem truc tiep (results-panel.tsx)
// TAT CA field o day deu .optional() va toan bo schema chi dung qua .safeParse() -
// day la du lieu THAM KHAO/audit-trail, KHONG PHAI dieu kien thanh cong cua request:
// neu AI tra "analysis" thieu/sai 1 vai field, request generate VAN PHAI thanh cong
// mien la "test_cases" hop le (day la deliverable chinh) - xem app/api/ai/generate/route.ts.
const analysisFieldEpBvaItemSchema = z.object({
  field: z.string().optional(),
  valid_equivalence_classes: z.array(z.string()).optional(),
  invalid_equivalence_classes: z.array(z.string()).optional(),
  boundary_values: z.array(z.string()).optional(),
});

const analysisRiskRankingItemSchema = z.object({
  scenario: z.string().optional(),
  severity_1_10: z.number().optional(),
  probability_1_10: z.number().optional(),
  detectability_1_10: z.number().optional(),
  resulting_priority: z.string().optional(),
});

const analysisDocumentAtomPlanItemSchema = z.object({
  atom_id: z.string().optional(),
  planned_test_case_code: z.string().optional(),
});

export const generationAnalysisSchema = z.object({
  input_source: z.string().optional(),
  explicit_rules: z.array(z.string()).optional(),
  implicit_rules: z.array(z.string()).optional(),
  ambiguous_terms: z.array(z.string()).optional(),
  actors_and_preconditions: z.array(z.string()).optional(),
  fields_ep_bva: z.array(analysisFieldEpBvaItemSchema).optional(),
  state_transitions: z.array(z.string()).optional(),
  attack_and_chaos_vectors: z.array(z.string()).optional(),
  cross_cutting_checks: z.array(z.string()).optional(),
  risk_ranking: z.array(analysisRiskRankingItemSchema).optional(),
  document_atom_plan: z.array(analysisDocumentAtomPlanItemSchema).optional(),
  coverage_self_check: z.array(z.string()).optional(),
});

export type GenerationAnalysis = z.infer<typeof generationAnalysisSchema>;

export const generateRequestSchema = z
  .object({
    // Khong con bat buoc min(20) o day nua: mot minh field nay co the rong neu
    // document_context (Figma/tai lieu dinh kem) da co du lieu - xem superRefine ben duoi
    // cho rule "it nhat muc 1 (requirement) hoac muc 2 (document reader) phai co data".
    requirement_description: z.string().default(''),
    selected_categories: z.array(testCaseCategorySchema).min(1),
    language: z.string().min(2).default('Tiếng Việt'),
    detail_level: z.enum(['concise', 'standard', 'detailed']).default('standard'),
    retrieved_old_test_cases: z.array(retrievedTestCaseSchema).optional().default([]),
    // AI Document Reader: Figma design / Markdown / logic document / FS / ERD / diagram
    // da duoc atomize truoc qua /api/ai/documents/parse (xem lib/validators/document.ts).
    document_context: z.array(parsedDocumentSchema).optional().default([]),
  })
  .superRefine((data, ctx) => {
    const trimmedDescription = data.requirement_description.trim();
    const hasRequirement = trimmedDescription.length >= 20;
    const hasDocuments = (data.document_context ?? []).length > 0;

    if (!hasRequirement && !hasDocuments) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['requirement_description'],
        message:
          trimmedDescription.length > 0
            ? 'Requirement / description quá ngắn (tối thiểu 20 ký tự). Hãy bổ sung mô tả hoặc đính kèm ít nhất 1 tài liệu/Figma ở mục AI Document Reader.'
            : 'Cần nhập Requirement / description (tối thiểu 20 ký tự) hoặc đính kèm ít nhất 1 tài liệu/Figma ở mục AI Document Reader.',
      });
    }
  });

export const reviewRequestSchema = z.object({
  requirement_description: z.string().min(20),
  generated_test_cases: generatedTestCasesSchema,
});

export type TestCaseCategory = z.infer<typeof testCaseCategorySchema>;
export type GeneratedTestCase = z.infer<typeof generatedTestCaseSchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;
