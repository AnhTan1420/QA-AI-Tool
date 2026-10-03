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

// ── Review result (bounded QA evaluation) ─────────────────────────────────
// Review EVALUATES against the generation standard (services/ai/quality-standards.ts)
// and returns compact findings only. It deliberately has NO free-form
// "analysis"/reasoning field, NO score, and NO suggested/rewritten test cases:
// those were what made the old Review consume the whole output-token budget and
// blur the line between Review (what is wrong) and Enhance (fix it).
//
// JSON keys are snake_case like every other payload in this codebase.

export const detailStatusSchema = z.enum(['TOO_VAGUE', 'APPROPRIATE', 'OVER_DETAILED']);
export const taxonomyStatusSchema = z.enum([
  'SUPPORTED',
  'PARTIALLY_SUPPORTED',
  'MISSING',
  'NOT_APPLICABLE',
  'INSUFFICIENT_EVIDENCE',
]);
export const reviewOverallStatusSchema = z.enum(['PASS', 'NEEDS_IMPROVEMENT', 'FAIL']);
const severitySchema = z.enum(['Critical', 'Major', 'Minor']);
export const reviewIssueAreaSchema = z.enum(['language_detail', 'taxonomy', 'executability', 'consistency']);

export const reviewResultSchema = z.object({
  overall_status: reviewOverallStatusSchema,
  /** One deterministic line built by the application (no model tokens). */
  summary: z.string().optional(),
  language_detail: z.object({
    status: detailStatusSchema,
    counts: z.object({
      TOO_VAGUE: z.number().int().min(0),
      APPROPRIATE: z.number().int().min(0),
      OVER_DETAILED: z.number().int().min(0),
    }),
    issues: z.array(
      z.object({
        test_case_code: z.string().min(1),
        status: detailStatusSchema,
        reason: z.string(),
        source: z.enum(['rule', 'ai']).optional(),
      }),
    ),
  }),
  taxonomy: z.array(
    z.object({
      category: testCaseCategorySchema,
      status: taxonomyStatusSchema,
      evidence: z.string(),
      supporting_codes: z.array(z.string()).default([]),
    }),
  ),
  issues: z.array(
    z.object({
      test_case_code: z.string().optional(),
      severity: severitySchema,
      area: reviewIssueAreaSchema,
      description: z.string().min(1),
      evidence: z.string().min(1),
    }),
  ),
  recommendations: z.array(z.string()),
  /** Structural errors found by deterministic validation (duplicate codes etc.). */
  structure_errors: z.array(z.string()).optional(),
});

/**
 * What the MODEL returns for Review — deliberately lenient (every array
 * defaults to []) so a response salvaged after truncation still parses. The
 * application then clamps, filters and merges it with deterministic findings
 * (services/ai/review-analysis.ts finalizeReview) before anything is returned.
 */
export const reviewModelOutputSchema = z.object({
  language_detail: z
    .array(
      z.object({
        test_case_code: z.string().default(''),
        status: detailStatusSchema.catch('TOO_VAGUE'),
        reason: z.string().default(''),
      }),
    )
    .default([]),
  taxonomy: z
    .array(
      z.object({
        category: z.string().default(''),
        status: taxonomyStatusSchema.catch('INSUFFICIENT_EVIDENCE'),
        evidence: z.string().default(''),
        supporting_codes: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  issues: z
    .array(
      z.object({
        test_case_code: z.string().optional(),
        severity: severitySchema.catch('Minor'),
        area: reviewIssueAreaSchema.catch('consistency'),
        description: z.string().default(''),
        evidence: z.string().default(''),
      }),
    )
    .default([]),
  recommendations: z.array(z.string()).default([]),
});
export type ReviewModelOutput = z.infer<typeof reviewModelOutputSchema>;

// Analysis cua Enhance Agent — cung mot loi cu: prompt yeu cau model liet ke
// dung nhung gap nao da duoc dong va atom nao vua chuyen tu uncovered sang
// covered, roi route chi lay `test_cases` va vut phan con lai. Do chinh la ban
// ghi "AI da lam gi" ma nguoi review can de duyet ket qua.
export const enhanceAnalysisSchema = z.object({
  gaps_addressed: z.array(z.string()).optional(),
  atoms_newly_covered: z.array(z.string()).optional(),
  total_cases_before: z.number().optional(),
  total_cases_after: z.number().optional(),
});
export type EnhanceAnalysis = z.infer<typeof enhanceAnalysisSchema>;

export type ReviewSeverity = z.infer<typeof severitySchema>;
export type DetailStatusValue = z.infer<typeof detailStatusSchema>;
export type TaxonomyStatusValue = z.infer<typeof taxonomyStatusSchema>;

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
    // Gioi han cung: input KHONG bi cat am tham (se lam mat nguon yeu cau) ma bi tu
    // choi ro rang — nguoi dung chia nho yeu cau hoac dung tai lieu dinh kem.
    requirement_description: z.string().max(40_000, 'Mô tả yêu cầu quá dài (tối đa 40.000 ký tự). Hãy chia nhỏ hoặc dùng tài liệu đính kèm.').default(''),
    selected_categories: z.array(testCaseCategorySchema).min(1),
    language: z.string().min(2).default('Tiếng Việt'),
    detail_level: z.enum(['concise', 'standard', 'detailed']).default('standard'),
    // RAG chi dung de hoc VAN PHONG (PHASE 1) -> toi da 20 (bang tran match_count cua /api/ai/retrieve).
    retrieved_old_test_cases: z.array(retrievedTestCaseSchema).max(20).optional().default([]),
    // AI Document Reader: Figma design / Markdown / logic document / FS / ERD / diagram
    // da duoc atomize truoc qua /api/ai/documents/parse (xem lib/validators/document.ts).
    document_context: z.array(parsedDocumentSchema).max(20).optional().default([]),
    // ── Tiep tuc (resume) do CLIENT dieu khien ──────────────────────────────
    // Moi request Vercel co ngan sach thoi gian rieng. Khi 1 lan chay het ngan
    // sach, server tra ve ket qua TUNG PHAN kem `progress`; client gui lai CHINH
    // cac test case da co + cac category da xong de lam TIEP phan con lai (khong
    // lam lai tu dau, khong tao ban ghi trung — merge khu trung theo ma/tieu de).
    existing_test_cases: z.array(retrievedTestCaseSchema).max(500).optional().default([]),
    completed_categories: z.array(testCaseCategorySchema).optional().default([]),
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

export type TestCaseCategory = z.infer<typeof testCaseCategorySchema>;
export type GeneratedTestCase = z.infer<typeof generatedTestCaseSchema>;
export type ReviewResult = z.infer<typeof reviewResultSchema>;
