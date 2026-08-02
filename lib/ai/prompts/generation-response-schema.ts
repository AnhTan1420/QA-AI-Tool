// ============================================================================
// File: generation-response-schema.ts
// ============================================================================
// Structured Output schema (Gemini "responseSchema" / Controlled Generation)
// danh rieng cho tac vu generation (xem app/api/ai/generate/route.ts).
//
// TAI SAO FILE NAY TON TAI:
// generation-agent.ts (prompt text) da ep buoc "analysis" phai la KEY DUNG
// TRUOC "test_cases" trong JSON output, va giai thich model se sinh JSON tuan
// tu trai->phai nen key truoc se duoc "nghi" truoc. Dieu do dung, nhung no van
// chi la 1 CHI DAN BANG TEXT - model VAN CO THE lam sai thu tu neu no "quen"
// hoac danh gia thap muc do quan trong cua chi dan do.
//
// Gemini con co 1 co che ep buoc o CAP API, manh hon nhieu: khi truyen
// `responseSchema` cung voi `responseMimeType: "application/json"`, API dung
// "constrained decoding" - tai MOI vi tri trong JSON, model CHI duoc phep sinh
// token nao khop voi schema, va thu tu cac property duoc quyet dinh boi mang
// `propertyOrdering` trong schema (day la tinh nang chinh thuc cua Structured
// Output API, khong phai "prompt engineering"). Nghia la voi file nay, "analysis"
// LUON duoc sinh xong truoc "test_cases" boi vi HA TANG khong cho phep model
// lam khac di - khong con phu thuoc hoan toan vao "model co nghe loi hay khong".
//
// AN TOAN / FALLBACK: gemini.ts (xem callGeminiOnce + generateWithGemini) co san
// co che tu dong THU LAI KHONG KEM SCHEMA neu 1 model cu the tra loi 400/khong
// tuong thich voi schema nay - luc do he thong lui ve dung prompt text (PHASE 0)
// nhu truoc, khong lam sap tinh nang generate. File schema nay vi vay la 1 lop
// tang cuong THEM, khong phai diem-that-bai-duy-nhat (single point of failure).
//
// VI SAO "test_cases[].items" CHI LA { type: OBJECT } - KHONG khai bao properties
// chi tiet (code/title/category/priority/steps/test_data/...):
// Truong "test_data" cua moi test case la 1 string map TU DO (VD:
// { "email": "a@b.com", "so_luong": "5" }) - ten va so luong key thay doi tuy
// test case, khong biet truoc duoc. Structured Output cua Gemini dua tren 1
// subset cua OpenAPI Schema va KHONG ho tro tot object-voi-key-dong (kieu
// additionalProperties/map tu do): neu khai bao san 1 danh sach "properties" cu
// the cho item cua test_cases, constrained decoding se CHI cho phep sinh dung
// nhung key da liet ke - "test_data" (va bat ky field nao khac khong duoc liet
// ke) se BI CHAN, khong the xuat hien trong output. Vi vay item cua test_cases
// duoc co tinh de MO (khong properties), dua vao JSON_SCHEMA_CONTRACT trong
// prompt text (generation-agent.ts) + Zod (lib/validators/test-case.ts) de dam
// bao dinh dang - dung nhu truoc day, khong regression. Phan duoc rang buoc chat
// che nhat qua schema la "analysis" - noi ma cau truc + THU TU sinh ra la dieu
// thuc su can dam bao.
//
// LUU Y VE "Type" ENUM: co ham dung chuoi string literal ("OBJECT", "ARRAY",
// "STRING", "INTEGER") thay vi import enum `Type` tu '@google/genai'. Day la
// lua chon co chu dich: gia tri day chinh la dinh dang JSON-over-the-wire ma
// Gemini REST API mong doi (xem tai lieu Structured Output cua Google) - enum
// `Type` trong SDK JS/TS chi la 1 lop wrapper tien loi cho autocomplete, ban
// than no cung chi ánh xa toi dung cac chuoi nay. Dung thang string literal
// giup file nay khong phu thuoc vao ten export chinh xac cua tung phien ban
// @google/genai, giam rui ro loi bien dich/runtime khi nang cap package.

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

export function buildGenerationResponseSchema(): GeminiSchema {
  return {
    type: 'OBJECT',
    properties: {
      analysis: ANALYSIS_SCHEMA,
      test_cases: {
        type: 'ARRAY',
        description:
          'Bộ test case cuối cùng. Mỗi phần tử PHẢI khớp JSON_SCHEMA_CONTRACT trong prompt text (bao gồm "test_data" — 1 map string tự do, cố tình KHÔNG bị ràng buộc chi tiết ở schema này, xem comment đầu file).',
        // Co tinh khong khai bao "properties" o day — xem comment dau file.
        items: { type: 'OBJECT' },
      },
    },
    required: ['analysis', 'test_cases'],
    propertyOrdering: ['analysis', 'test_cases'],
  };
}
