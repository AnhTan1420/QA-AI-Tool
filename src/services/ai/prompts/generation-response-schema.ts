import { CATEGORY_VALUES } from '@/models/validators/test-case';

type GeminiSchema = Record<string, unknown>;

const STRING_ARRAY: GeminiSchema = { type: 'ARRAY', items: { type: 'STRING' } };

function withDescription(schema: GeminiSchema, description: string): GeminiSchema {
  return { ...schema, description };
}

const FIELDS_EP_BVA_ITEM: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    field: { type: 'STRING', description: 'Tên field/parameter đang phân tích.' },
    valid_equivalence_classes: STRING_ARRAY,
    invalid_equivalence_classes: STRING_ARRAY,
    boundary_values: STRING_ARRAY,
  },
  required: ['field', 'valid_equivalence_classes', 'invalid_equivalence_classes', 'boundary_values'],
  propertyOrdering: ['field', 'valid_equivalence_classes', 'invalid_equivalence_classes', 'boundary_values'],
};

const RISK_RANKING_ITEM: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    scenario: { type: 'STRING' },
    severity_1_10: { type: 'INTEGER' },
    probability_1_10: { type: 'INTEGER' },
    detectability_1_10: { type: 'INTEGER' },
    resulting_priority: { type: 'STRING', enum: ['Critical', 'Major', 'Normal'] },
  },
  required: ['scenario', 'severity_1_10', 'probability_1_10', 'detectability_1_10', 'resulting_priority'],
  propertyOrdering: ['scenario', 'severity_1_10', 'probability_1_10', 'detectability_1_10', 'resulting_priority'],
};

const DOCUMENT_ATOM_PLAN_ITEM: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    atom_id: { type: 'STRING' },
    planned_test_case_code: { type: 'STRING' },
  },
  required: ['atom_id', 'planned_test_case_code'],
  propertyOrdering: ['atom_id', 'planned_test_case_code'],
};

// Thu tu key duoi day CHINH LA thu tu 7-layer trong PHASE 0 cua generation-agent.ts
// (Layer 1 -> 7) — giu dong bo giua 2 file neu sua doi sau nay.
const ANALYSIS_PROPERTY_ORDER = [
  'input_source',
  'explicit_rules',
  'implicit_rules',
  'ambiguous_terms',
  'actors_and_preconditions',
  'fields_ep_bva',
  'state_transitions',
  'attack_and_chaos_vectors',
  'cross_cutting_checks',
  'risk_ranking',
  'document_atom_plan',
  'coverage_self_check',
] as const;

const ANALYSIS_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  description:
    'PHASE 0 — phân tích sâu 7 lớp, BẮT BUỘC được sinh TRƯỚC "test_cases" (ép bởi propertyOrdering ở cấp API, không chỉ dựa vào prompt text).',
  properties: {
    input_source: {
      type: 'STRING',
      enum: ['requirement_description', 'document_context', 'both'],
      description: 'Mục 1 (Requirement/description) hay Mục 2 (AI Document Reader) — hoặc cả hai — thực sự có dữ liệu dùng được.',
    },
    explicit_rules: withDescription(STRING_ARRAY, 'Mọi business rule / điều kiện / ràng buộc được nói rõ trong nguồn.'),
    implicit_rules: withDescription(STRING_ARRAY, 'Rule mà nguồn NGẦM ĐỊNH nhưng không nói ra.'),
    ambiguous_terms: withDescription(STRING_ARRAY, 'Từ/cụm từ mơ hồ (VD "hợp lệ", "nhanh chóng") và test gap nó tạo ra.'),
    actors_and_preconditions: withDescription(STRING_ARRAY, 'Actor / pre-condition / post-condition / invariant.'),
    fields_ep_bva: {
      type: 'ARRAY',
      items: FIELDS_EP_BVA_ITEM,
      description: 'Equivalence Partitioning + Boundary Value Analysis cho từng field/parameter.',
    },
    state_transitions: withDescription(STRING_ARRAY, 'State machine: các trạng thái và chuyển trạng thái hợp lệ/không hợp lệ.'),
    attack_and_chaos_vectors: withDescription(STRING_ARRAY, 'Kịch bản tấn công/chaos engineering đáng để test.'),
    cross_cutting_checks: withDescription(STRING_ARRAY, 'Mối quan tâm xuyên suốt hệ thống: audit log, notification, cache, idempotency, PII...'),
    risk_ranking: {
      type: 'ARRAY',
      items: RISK_RANKING_ITEM,
      description: 'Xếp hạng rủi ro kiểu FMEA (severity × probability × detectability) → priority.',
    },
    document_atom_plan: {
      type: 'ARRAY',
      items: DOCUMENT_ATOM_PLAN_ITEM,
      description: 'Ánh xạ từng atom tài liệu (Figma/FS/ERD) tới 1 test case sẽ cover nó. Để mảng rỗng nếu không có tài liệu đính kèm.',
    },
    coverage_self_check: withDescription(STRING_ARRAY, 'Tự kiểm tra độ phủ trước khi viết test case (Layer 7).'),
  },
  required: [...ANALYSIS_PROPERTY_ORDER],
  propertyOrdering: [...ANALYSIS_PROPERTY_ORDER],
};

// TEST_CASE_ITEM_SCHEMA — PHAI khop voi generatedTestCaseSchema (lib/validators/test-case.ts)
// va TEST_CASE_SCHEMA_CONTRACT (generation-agent.ts).
//
// SUA LOI QUAN TRONG (2026-08): truoc day item nay duoc de "{ type: 'OBJECT' }"
// KHONG khai bao "properties", voi y dinh la de model tu do sinh field (vi
// "test_data" la 1 map key dong). Nhung voi Gemini Structured Output,
// "type: OBJECT" KHONG khai bao "properties" KHONG dong nghia voi "object tu
// do" - no bi hieu la "object khong co field nao duoc phep", nen constrained
// decoding EP model sinh ra {} cho MOI phan tu trong test_cases, bat ke prompt
// text yeu cau gi (day chinh la nguyen nhan loi "AI tra ve du lieu khong dung
// dinh dang test case" voi TAT CA field cua item 0 deu bao "Required").
//
// Fix: khai bao day du "properties" cho cac field co cau truc co dinh. Rieng
// "test_data" (map string tu do, ten key khong biet truoc) CO TINH duoc BO
// KHOI danh sach properties (khong khai bao) thay vi ep type OBJECT rong -
// vi no la optional o Zod (.optional().default({})), thieu field nay khong
// lam fail validate; nguoc lai neu khai bao no nhu 1 OBJECT rong thi no se
// LUON ra rong tu AI (cung 1 loi nhu tren, chi la o field con thay vi ca item).
const TEST_CASE_STEP_ITEM: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    step_number: { type: 'INTEGER' },
    action: { type: 'STRING' },
    expected_result: { type: 'STRING' },
  },
  required: ['step_number', 'action', 'expected_result'],
  propertyOrdering: ['step_number', 'action', 'expected_result'],
};

const TEST_CASE_ITEM_PROPERTY_ORDER = [
  'code',
  'title',
  'category',
  'priority',
  'preconditions',
  'steps',
  'final_expected_result',
  'source_requirement_ids',
] as const;

const TEST_CASE_ITEM_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  description:
    'Phai khop TEST_CASE_SCHEMA_CONTRACT trong prompt text. "test_data" (map string tu do) CO TINH khong khai bao o day - xem comment phia tren file nay.',
  properties: {
    code: { type: 'STRING' },
    title: { type: 'STRING' },
    category: { type: 'STRING', enum: CATEGORY_VALUES as unknown as string[] },
    priority: { type: 'STRING', enum: ['Critical', 'Major', 'Normal'] },
    preconditions: STRING_ARRAY,
    steps: { type: 'ARRAY', items: TEST_CASE_STEP_ITEM },
    final_expected_result: { type: 'STRING' },
    source_requirement_ids: STRING_ARRAY,
  },
  required: ['code', 'title', 'category', 'priority', 'steps', 'final_expected_result'],
  propertyOrdering: [...TEST_CASE_ITEM_PROPERTY_ORDER],
};

export function buildGenerationResponseSchema(): GeminiSchema {
  return {
    type: 'OBJECT',
    properties: {
      analysis: ANALYSIS_SCHEMA,
      test_cases: {
        type: 'ARRAY',
        description:
          'Bo test case cuoi cung. Moi phan tu PHAI khop JSON_SCHEMA_CONTRACT trong prompt text.',
        items: TEST_CASE_ITEM_SCHEMA,
      },
    },
    required: ['analysis', 'test_cases'],
    propertyOrdering: ['analysis', 'test_cases'],
  };
}
