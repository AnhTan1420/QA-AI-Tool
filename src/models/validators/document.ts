import { z } from 'zod';
import { MAX_INLINE_BASE64_CHARS, formatMb, MAX_INLINE_BASE64_UPLOAD_BYTES } from '@/lib/utils/upload-limits';

// Defense-in-depth cho `data_base64`: Vercel da chan cung o platform level (413
// FUNCTION_PAYLOAD_TOO_LARGE) truoc khi request toi duoc route handler neu body
// vuot ~4.5MB, nen check nay it khi kich hoat trong thuc te - nhung neu co client
// nao khac (khong phai UI hien tai, vd goi API truc tiep) gui 1 payload lot qua
// duoc gioi han cua Vercel nhung van qua kha nang xu ly hop ly cua route, ta van
// muon tra ve 1 loi Zod ro rang thay vi de AI Vision/mammoth xu ly 1 buffer khong
// lo mot cach am tham. Xem lib/utils/upload-limits.ts.
const base64UploadSchema = z
  .string()
  .min(1)
  .max(MAX_INLINE_BASE64_CHARS, { message: `File vượt quá ${formatMb(MAX_INLINE_BASE64_UPLOAD_BYTES)} — vui lòng dùng file nhỏ hơn.` });

// ============================================================================
// AI Document Reader — validators
// ----------------------------------------------------------------------------
// Cho phep Generation Agent doc va map Figma design / Markdown / logic document /
// Functional Specification (FS) / ERD / diagram vao test case. Moi tai lieu duoc
// "atomize" (chia nho) thanh cac "atom" — don vi co the test duoc doc lap (1 rule,
// 1 field, 1 UI element, 1 entity/column, 1 flow step...). Muc tieu "mapping 100%":
// moi atom_id PHAI xuat hien trong source_requirement_ids cua it nhat 1 test case
// (xem lib/ai/prompts/generation-agent.ts PHASE 0.5 + lib/documents/coverage.ts).
// ============================================================================

const ATOM_TYPE_VALUES = [
  'rule',
  'field',
  'screen_element',
  'entity',
  'entity_field',
  'relationship',
  'flow_step',
  'state',
  'condition',
] as const;

export const documentAtomTypeSchema = z.enum(ATOM_TYPE_VALUES);

// AI (va nguoi dung import lai document da parse) thinh thoang tra ve nhan gan
// dung thay vi dung enum slug (VD "UI Element", "business-rule", "Column") ->
// chuan hoa truoc khi validate, cung tinh than voi normalizeCategoryValue trong
// lib/validators/test-case.ts.
function normalizeAtomType(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[\s\-/]+/g, '_')
    .replace(/_+/g, '_');

  if ((ATOM_TYPE_VALUES as readonly string[]).includes(slug)) return slug;

  const aliasMap: Record<string, (typeof ATOM_TYPE_VALUES)[number]> = {
    business_rule: 'rule',
    validation_rule: 'rule',
    requirement: 'rule',
    requirement_clause: 'rule',
    column: 'entity_field',
    table_field: 'entity_field',
    attribute: 'entity_field',
    table: 'entity',
    db_entity: 'entity',
    db_table: 'entity',
    ui_element: 'screen_element',
    ui_component: 'screen_element',
    component: 'screen_element',
    control: 'screen_element',
    widget: 'screen_element',
    label: 'screen_element',
    button: 'screen_element',
    text_element: 'screen_element',
    text_layer: 'screen_element',
    step: 'flow_step',
    process_step: 'flow_step',
    decision: 'flow_step',
    decision_node: 'flow_step',
    status: 'state',
    edge_case: 'condition',
    constraint: 'condition',
    fk: 'relationship',
    foreign_key: 'relationship',
    cardinality: 'relationship',
  };
  return aliasMap[slug] ?? value;
}

const lenientAtomTypeSchema = z.preprocess(normalizeAtomType, documentAtomTypeSchema);

export const documentAtomSchema = z.object({
  atom_id: z.string().min(1),
  atom_type: lenientAtomTypeSchema,
  label: z.string().min(1),
  detail: z.string().min(1),
  screen_or_section: z.string().optional(),
});

export type DocumentAtom = z.infer<typeof documentAtomSchema>;

export const documentSourceTypeSchema = z.enum(['document', 'diagram_image', 'figma']);
export type DocumentSourceType = z.infer<typeof documentSourceTypeSchema>;

// ── Ket qua cuoi cung, da chuan hoa (id + source_type gan boi server) — day la
// hinh dang duoc luu trong workspace client va gui kem trong document_context
// khi goi /api/ai/generate. ──
// Provenance cua buoc doc tai lieu (services/documents/reader.ts). Tat ca deu
// optional va chi de HIEN THI/audit: nguoi dung phai thay duoc "tai lieu nay
// duoc doc lam may phan, co phan nao loi khong, audit bo sung bao nhieu atom"
// thay vi phai tin rang inventory la day du.
export const documentReaderStatsSchema = z.object({
  source_chars: z.number(),
  chunks: z.number(),
  atoms_first_pass: z.number(),
  atoms_from_audit: z.number(),
  duplicates_removed: z.number(),
  failed_chunks: z.number(),
});
export type DocumentReaderStats = z.infer<typeof documentReaderStatsSchema>;

export const parsedDocumentSchema = z.object({
  id: z.string().min(1),
  source_type: documentSourceTypeSchema,
  title: z.string().min(1),
  file_name: z.string().optional(),
  summary: z.string().min(1),
  atoms: z.array(documentAtomSchema).min(1),
  reader_stats: documentReaderStatsSchema.optional(),
  reader_warnings: z.array(z.string()).optional(),
});

export type ParsedDocument = z.infer<typeof parsedDocumentSchema>;

// ── Output THO tu Document Extraction Agent (chua co id/source_type, server se
// gan sau khi validate) — dung cho ca nhanh text (Markdown/FS/logic doc/PDF/DOCX)
// lan nhanh vision (anh diagram/ERD/UI mockup). ──
export const documentExtractionResultSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  atoms: z.array(documentAtomSchema).min(1),
});

export type DocumentExtractionResult = z.infer<typeof documentExtractionResultSchema>;

// ── Request body cho /api/ai/documents/parse — 3 nhanh theo source_type. ──
export const parseTextDocumentRequestSchema = z.object({
  source_type: z.literal('document'),
  file_name: z.string().min(1),
  // 'text' | 'markdown': client da doc file bang File.text() -> field `content`.
  // 'pdf' | 'docx': client doc file bang base64 -> field `data_base64`, server
  // tu extract text bang lib/documents/text-extractors.ts.
  file_format: z.enum(['text', 'markdown', 'pdf', 'docx']),
  content: z.string().min(1).optional(),
  data_base64: base64UploadSchema.optional(),
});
export type ParseTextDocumentRequest = z.infer<typeof parseTextDocumentRequestSchema>;

export const parseImageDocumentRequestSchema = z.object({
  source_type: z.literal('diagram_image'),
  file_name: z.string().min(1),
  mime_type: z.string().min(1),
  data_base64: base64UploadSchema,
});
export type ParseImageDocumentRequest = z.infer<typeof parseImageDocumentRequestSchema>;

export const parseFigmaDocumentRequestSchema = z.object({
  source_type: z.literal('figma'),
  figma_url: z.string().min(1),
  // Optional: neu bo trong, server fallback ve process.env.FIGMA_ACCESS_TOKEN.
  figma_token: z.string().optional(),
});
export type ParseFigmaDocumentRequest = z.infer<typeof parseFigmaDocumentRequestSchema>;

export const parseDocumentRequestSchema = z.discriminatedUnion('source_type', [
  parseTextDocumentRequestSchema,
  parseImageDocumentRequestSchema,
  parseFigmaDocumentRequestSchema,
]);

export type ParseDocumentRequest = z.infer<typeof parseDocumentRequestSchema>;
