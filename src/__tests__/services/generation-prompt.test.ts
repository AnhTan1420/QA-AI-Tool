/**
 * Unit test cho buildGenerationPrompt (src/services/ai/prompts/generation-agent.ts)
 * — riêng phần `category_floor_cap`, phần sửa cho sự cố /api/ai/generate ngày
 * 24/9 (429 rồi timeout lặp lại vì 1 lần gọi phải gánh quá nhiều case).
 *
 * buildGenerationPrompt là hàm THUẦN: không gọi Gemini, không đọc env — chỉ cần
 * gọi nó và soi chuỗi prompt trả về (phần "MANDATORY CONFIGURATION" ghi rõ
 * "Minimum cases: X total, with AT LEAST Y cases per selected category").
 */
import { describe, it, expect } from 'vitest';
import { buildGenerationPrompt, capDocumentAtomsForInitialGeneration } from '@/services/ai/prompts/generation-agent';
import type { ParsedDocument } from '@/models/validators/document';

const base = {
  requirement_description: 'Hệ thống phải cho phép người dùng đăng nhập bằng email và mật khẩu.',
  retrieved_old_test_cases: [],
  language: 'Tiếng Việt',
  document_context: [],
};

/** Bóc "Minimum cases: N total, with AT LEAST M cases per selected category" từ prompt. */
function readMinimums(prompt: string): { total: number; perCategory: number } {
  const match = /Minimum cases: (\d+) total, with AT LEAST (\d+) cases per selected category/.exec(prompt);
  if (!match) throw new Error('Không tìm thấy dòng "Minimum cases" trong prompt');
  return { total: Number(match[1]), perCategory: Number(match[2]) };
}

describe('buildGenerationPrompt — category_floor_cap', () => {
  it('không truyền category_floor_cap: giữ NGUYÊN hành vi cũ (perCategoryMin đầy đủ theo detail_level)', () => {
    const prompt = buildGenerationPrompt({
      ...base,
      selected_categories: ['positive', 'negative', 'boundary'],
      detail_level: 'standard',
    });
    expect(readMinimums(prompt)).toEqual({ total: 12, perCategory: 4 }); // 4 (standard) x 3 category, như trước khi có cap
  });

  it('category_floor_cap ĐỦ RỘNG cho số category đã chọn: không đổi gì (Math.min không kích hoạt)', () => {
    const prompt = buildGenerationPrompt({
      ...base,
      selected_categories: ['positive', 'negative', 'boundary'],
      detail_level: 'standard',
      category_floor_cap: 100, // rất rộng
    });
    expect(readMinimums(prompt)).toEqual({ total: 12, perCategory: 4 });
  });

  it('chọn NHIỀU category vượt cap: perCategoryMin bị GIẢM để tổng số case luôn nằm trong cap', () => {
    const categories = ['positive', 'negative', 'boundary', 'ui_ux', 'compatibility', 'performance', 'security', 'integration', 'regression', 'accessibility', 'localization'] as const;
    const prompt = buildGenerationPrompt({
      ...base,
      selected_categories: [...categories], // đủ 11 category, giới hạn tối đa của schema
      detail_level: 'standard',
      category_floor_cap: 14,
    });
    const { total, perCategory } = readMinimums(prompt);
    expect(perCategory).toBeLessThan(4); // nominal 'standard' là 4 — PHẢI bị giảm
    expect(perCategory).toBeGreaterThanOrEqual(1); // không bao giờ về 0
    expect(total).toBeLessThanOrEqual(11 * 4); // luôn thấp hơn mức không-giới-hạn
  });

  it('cap nhỏ hơn cả số category đã chọn: mỗi category vẫn được ÍT NHẤT 1 case, không bao giờ 0', () => {
    const categories = Array.from({ length: 11 }, (_, i) => ['positive', 'negative', 'boundary', 'ui_ux', 'compatibility', 'performance', 'security', 'integration', 'regression', 'accessibility', 'localization'][i]) as ('positive' | 'negative' | 'boundary' | 'ui_ux' | 'compatibility' | 'performance' | 'security' | 'integration' | 'regression' | 'accessibility' | 'localization')[];
    const prompt = buildGenerationPrompt({
      ...base,
      selected_categories: categories,
      detail_level: 'detailed',
      category_floor_cap: 3, // nhỏ hơn 11 category
    });
    const { perCategory } = readMinimums(prompt);
    expect(perCategory).toBe(1);
  });

  it('detail_level "detailed" (nominal 6/category) bị giảm mạnh hơn "concise" (nominal 2) khi cùng chọn nhiều category', () => {
    const categories = ['positive', 'negative', 'boundary', 'ui_ux', 'compatibility', 'performance', 'security', 'integration'] as const;
    const detailed = readMinimums(
      buildGenerationPrompt({ ...base, selected_categories: [...categories], detail_level: 'detailed', category_floor_cap: 7 }),
    );
    const concise = readMinimums(
      buildGenerationPrompt({ ...base, selected_categories: [...categories], detail_level: 'concise', category_floor_cap: 22 }),
    );
    // 'concise' vốn đã yêu cầu ít hơn (nominal 2) nên cap 22 không cần giảm gì; 'detailed' (nominal 6) bị cap 7 ép giảm mạnh.
    expect(concise.perCategory).toBe(2);
    expect(detailed.perCategory).toBeLessThan(6);
  });

  it('chỉ chọn ÍT category ở "standard"/"concise": cap mặc định KHÔNG ảnh hưởng, giữ nguyên chất lượng nominal', () => {
    // Cap mặc định của model-registry cho 'standard'/'concise' đủ rộng cho 3 category
    // (trường hợp phổ biến nhất) — chỉ 'detailed' (case nặng gấp ~3 lần) mới bị ảnh hưởng
    // ngay cả với ít category, xem test kế tiếp.
    expect(readMinimums(buildGenerationPrompt({ ...base, selected_categories: ['positive', 'negative', 'boundary'], detail_level: 'standard', category_floor_cap: 14 }))).toEqual({ total: 12, perCategory: 4 });
    expect(readMinimums(buildGenerationPrompt({ ...base, selected_categories: ['positive', 'negative', 'boundary'], detail_level: 'concise', category_floor_cap: 22 }))).toEqual({ total: 6, perCategory: 2 });
  });

  it('"detailed" (case ~760 token, nặng nhất) VẪN bị giảm ngay cả với chỉ 3 category — đánh đổi có chủ đích: 1 case/category thấp hơn nominal vẫn tốt hơn generation thất bại hoàn toàn', () => {
    const prompt = buildGenerationPrompt({
      ...base,
      selected_categories: ['positive', 'negative', 'boundary'],
      detail_level: 'detailed',
      category_floor_cap: 7, // giá trị mặc định thực tế cho 'detailed' (xem model-registry)
    });
    const { perCategory } = readMinimums(prompt);
    expect(perCategory).toBeLessThan(6); // nominal 'detailed' là 6
    expect(perCategory).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// capDocumentAtomsForInitialGeneration — phần khác của cùng bản sửa lỗi 24/9:
// giới hạn số ATOM (thay vì per-category) đưa vào lần gọi generation đầu tiên.
// ============================================================================
describe('capDocumentAtomsForInitialGeneration', () => {
  const atom = (id: string) => ({ atom_id: id, atom_type: 'rule' as const, label: id, detail: id });
  const doc = (id: string, atomIds: string[]): ParsedDocument => ({
    id, source_type: 'document', title: id, summary: 's', atoms: atomIds.map(atom),
  });

  it('tổng atom trong hạn mức: giữ NGUYÊN mọi tài liệu và mọi atom', () => {
    const docs = [doc('A', ['a1', 'a2']), doc('B', ['b1'])];
    const result = capDocumentAtomsForInitialGeneration(docs, 10);
    expect(result).toEqual(docs);
  });

  it('vượt hạn mức: cắt ĐÚNG theo thứ tự xuất hiện, xuyên suốt nhiều tài liệu', () => {
    const docs = [doc('A', ['a1', 'a2', 'a3']), doc('B', ['b1', 'b2'])];
    const result = capDocumentAtomsForInitialGeneration(docs, 4);
    expect(result.map((d) => d.atoms.map((a) => a.atom_id))).toEqual([['a1', 'a2', 'a3'], ['b1']]);
  });

  it('tài liệu bị cắt hết atom (không còn atom nào lọt vào ngân sách) bị LOẠI khỏi danh sách trả về', () => {
    const docs = [doc('A', ['a1', 'a2']), doc('B', ['b1', 'b2'])];
    const result = capDocumentAtomsForInitialGeneration(docs, 2);
    expect(result.map((d) => d.id)).toEqual(['A']); // B bị loại hoàn toàn, không phải "Atoms (0)"
    expect(result[0].atoms).toHaveLength(2);
  });

  it('tài liệu VỐN DĨ không có atom nào (ví dụ chỉ có summary) được giữ nguyên, không bị loại', () => {
    const docs = [doc('A', []), doc('B', ['b1'])];
    const result = capDocumentAtomsForInitialGeneration(docs, 0);
    expect(result.map((d) => d.id)).toEqual(['A']);
  });

  it('atomCap=0: không tài liệu nào có atom được giữ (nhưng tài liệu 0-atom vẫn còn)', () => {
    const docs = [doc('A', ['a1'])];
    expect(capDocumentAtomsForInitialGeneration(docs, 0)).toEqual([]);
  });

  it('KHÔNG sửa đổi mảng/document gốc (immutable — coverage/repair vẫn cần bản đầy đủ)', () => {
    const docs = [doc('A', ['a1', 'a2', 'a3'])];
    const original = JSON.parse(JSON.stringify(docs));
    capDocumentAtomsForInitialGeneration(docs, 1);
    expect(docs).toEqual(original);
  });

  it('atomCap âm được coi như 0 (không crash, không nhận số âm)', () => {
    const docs = [doc('A', ['a1'])];
    expect(capDocumentAtomsForInitialGeneration(docs, -5)).toEqual([]);
  });
});
