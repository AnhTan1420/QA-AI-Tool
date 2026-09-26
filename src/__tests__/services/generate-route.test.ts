/**
 * Test cấp route cho /api/ai/generate — sự cố 24/9: 429 trên model chính rồi
 * TIMEOUT LẶP LẠI 3 lần (~180s) trên model phụ, cuối cùng thất bại hoàn toàn
 * (0 test case). Gọi thẳng `POST(new Request(...))`, Gemini được thay bằng
 * client giả lập phân biệt lời gọi generation / coverage_repair theo NỘI DUNG
 * prompt (task/label không tới được lớp SDK nên không thể phân biệt theo đó).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { POST } from '@/app/api/ai/generate/route';
import { __setGeminiClientFactoryForTests, type GeminiLikeClient } from '@/services/ai/gemini';
import type { ParsedDocument, DocumentAtom } from '@/models/validators/document';

const PRIMARY = 'gemini-3.5-flash';
const SECONDARY = 'gemini-3.5-flash-lite';

const httpError = (status: number) => Object.assign(new Error(`[${status}] upstream`), { status });
const timeoutError = () => Object.assign(new Error('The operation was aborted.'), { name: 'AbortError' });

const isRepairPrompt = (prompt: string) => prompt.includes('DOCUMENT COVERAGE REPAIR MODE');

function atom(id: string): DocumentAtom {
  return { atom_id: id, atom_type: 'rule', label: `Yêu cầu ${id}`, detail: `Chi tiết yêu cầu ${id}` };
}

function docWithAtoms(n: number): ParsedDocument {
  return {
    id: 'doc-1',
    source_type: 'document',
    title: 'R3C',
    summary: 'Tài liệu yêu cầu R3C',
    atoms: Array.from({ length: n }, (_, i) => atom(`R3C-${String(i + 1).padStart(3, '0')}`)),
  };
}

/** 1 test case hợp lệ tối thiểu theo schema, tùy chọn gắn atom_id để phủ coverage. */
function testCase(code: string, atomIds: string[] = []): Record<string, unknown> {
  return {
    code,
    title: `Kiểm tra ${code}`,
    category: 'positive',
    priority: 'Normal',
    preconditions: ['Điều kiện tiền đề'],
    test_data: { field: 'value' },
    steps: [{ step_number: 1, action: `Thực hiện hành động cho ${code}`, expected_result: 'Kết quả quan sát được' }],
    final_expected_result: `Kết thúc đúng cho ${code}`,
    source_requirement_ids: atomIds,
  };
}

/** Client giả lập: `behave(prompt)` trả về text override, null = phản hồi mặc định hợp lệ, hoặc ném lỗi. */
function fakeClient(behave: (prompt: string, model: string, n: number) => string | null | Promise<string | null>) {
  const calls: { model: string; isRepair: boolean }[] = [];
  let n = 0;
  const fake: GeminiLikeClient = {
    models: {
      generateContent: async (args) => {
        n++;
        const prompt = String(args.contents);
        const isRepair = isRepairPrompt(prompt);
        calls.push({ model: args.model, isRepair });
        const custom = await behave(prompt, args.model, n);
        if (custom) return { text: custom };
        if (isRepair) {
          // Repair chỉ trả case MỚI, không cần phủ hết — bài test tự quyết định có cần không.
          return { text: JSON.stringify({ test_cases: [testCase(`TC_REPAIR_${n}`)] }) };
        }
        // Mặc định: 1 case RIÊNG cho mỗi atom được nhắc trong prompt, có TRÍCH DẪN
        // đúng atom_id trong final_expected_result — để qua được kiểm tra "bằng
        // chứng ngữ nghĩa" của computeDocumentCoverage() (chỉ cite id không đủ,
        // xem coverage-evidence.ts). Không có atom nào -> 1 case chung chung.
        const atomIds = [...prompt.matchAll(/\[([A-Z0-9-]+-\d{3})\]/g)].map((m) => m[1]);
        const cases =
          atomIds.length > 0
            ? atomIds.map((id, i) => ({
                ...testCase(`TC_GEN_${String(i + 1).padStart(3, '0')}`, [id]),
                final_expected_result: `Hệ thống xử lý đúng theo atom ${id}`,
              }))
            : [testCase('TC_GEN_001')];
        return {
          text: JSON.stringify({
            analysis: { input_source: 'requirement_description', document_atom_plan: [] },
            test_cases: cases,
          }),
        };
      },
      embedContent: async () => ({ embeddings: [{ values: [0] }] }),
    },
  };
  return { fake, calls };
}

function post(body: Record<string, unknown>) {
  return POST(
    new Request('http://localhost/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requirement_description: 'Hệ thống phải cho phép người dùng đăng nhập bằng email và mật khẩu hợp lệ.',
        selected_categories: ['positive', 'negative'],
        language: 'Tiếng Việt',
        detail_level: 'standard',
        ...body,
      }),
    }),
  );
}

describe('POST /api/ai/generate', () => {
  beforeEach(() => {
    process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
    process.env.GEMINI_BACKOFF_BASE_MS = '0';
    process.env.AI_MODEL_PRIMARY = PRIMARY;
    process.env.AI_MODEL_FALLBACK_1 = SECONDARY;
    process.env.AI_MODEL_FALLBACK_2 = '';
    process.env.AI_MODEL_FALLBACK = '';
    process.env.AI_MAX_COVERAGE_REPAIR_ROUNDS = '1';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    __setGeminiClientFactoryForTests(null);
    for (const key of [
      'AI_MODEL_PRIMARY', 'AI_MODEL_FALLBACK_1', 'AI_MODEL_FALLBACK_2', 'AI_MODEL_FALLBACK',
      'AI_MAX_COVERAGE_REPAIR_ROUNDS', 'AI_GENERATION_REQUEST_TIMEOUT_MS', 'AI_GENERATION_INITIAL_ATOM_CAP',
      'AI_GENERATION_CATEGORY_FLOOR_CAP', 'AI_COVERAGE_REPAIR_BATCH_SIZE',
    ]) delete process.env[key];
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // ĐÚNG SỰ CỐ 24/9: model chính 429 (thoáng qua, retry vẫn qua được — không
  // đổi ở bản sửa này), model phụ TIMEOUT.
  // ==========================================================================
  describe('kịch bản đúng log sự cố (429 trên model chính, timeout trên model phụ)', () => {
    it('retryOnTimeout=false: model phụ timeout CHỈ được thử 1 LẦN (không phải 3 lần × 100s như log cũ)', async () => {
      // Ép model chính LUÔN thất bại (model_unavailable → chuyển model NGAY, không
      // tốn quota retry) để chắc chắn đi tới model phụ và đo đúng số lần gọi nó.
      const forced = fakeClient((_, model) => {
        if (model === PRIMARY) throw Object.assign(new Error('model not found'), { status: 404 });
        throw timeoutError();
      });
      __setGeminiClientFactoryForTests(() => forced.fake);

      const res = await post({});
      expect(res.status).toBe(503); // cả 2 model đều hỏng → 503 (khớp hành vi log cũ)

      const secondaryCalls = forced.calls.filter((c) => c.model === SECONDARY && !c.isRepair);
      expect(secondaryCalls).toHaveLength(1); // TRƯỚC bản sửa: sẽ là 3 (1 + 2 retry cùng model)
    });

    it('model chính 429 rồi model phụ trả lời TỐT: generation vẫn hoàn tất bình thường (failover hoạt động)', async () => {
      const { fake } = fakeClient((_, model) => {
        if (model === PRIMARY) throw httpError(429);
        return null;
      });
      __setGeminiClientFactoryForTests(() => fake);

      const res = await post({});
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.model_used).toBe(SECONDARY);
    });
  });

  // ==========================================================================
  // Timeout sizing: generation dùng timeout RIÊNG, cao hơn mặc định 60s dùng
  // chung cho document_extraction. Sàn của AI_GENERATION_REQUEST_TIMEOUT_MS là
  // 15s (xem model-registry.test.ts) nên KHÔNG kiểm bằng thời gian chờ thực tế
  // ở đây (30s+/lần chạy) — thay vào đó chặn provider để đọc thẳng option
  // `timeoutMs` mà route.ts truyền vào runGeminiTask.
  // ==========================================================================
  describe('kích thước timeout dành riêng cho generation', () => {
    it('route truyền ĐÚNG getGenerationRequestTimeoutMs() (không phải mặc định 60s dùng chung) vào lời gọi generation', async () => {
      process.env.AI_GENERATION_REQUEST_TIMEOUT_MS = '42000';
      const providerModule = await import('@/services/ai/provider');
      const spy = vi
        .spyOn(providerModule, 'runGeminiTask')
        .mockResolvedValue({
          data: { analysis: null, test_cases: [testCase('TC_GEN_001')] },
          model: PRIMARY,
          truncated: false,
          attempts: 1,
          schema_degraded: false,
          models_attempted: [PRIMARY],
        });

      await post({});

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ task: 'generation', timeoutMs: 42_000, retryOnTimeout: false }));
      spy.mockRestore();
    });

    it('không đặt env: dùng đúng mặc định 100_000ms của getGenerationRequestTimeoutMs(), không phải 60_000ms dùng chung', async () => {
      const providerModule = await import('@/services/ai/provider');
      const spy = vi
        .spyOn(providerModule, 'runGeminiTask')
        .mockResolvedValue({
          data: { analysis: null, test_cases: [testCase('TC_GEN_001')] },
          model: PRIMARY,
          truncated: false,
          attempts: 1,
          schema_degraded: false,
          models_attempted: [PRIMARY],
        });

      await post({});

      expect(spy).toHaveBeenCalledWith(expect.objectContaining({ task: 'generation', timeoutMs: 100_000 }));
      spy.mockRestore();
    });
  });

  // ==========================================================================
  // Atom cap cho lần gọi generation đầu tiên — phần thứ 2 của cùng bản sửa.
  // ==========================================================================
  describe('giới hạn atom cho lần gọi generation đầu tiên', () => {
    it('tài liệu vượt cap: prompt gọi Gemini CHỈ chứa đúng số atom = cap, phần còn lại do coverage repair đọc tiếp', async () => {
      process.env.AI_GENERATION_INITIAL_ATOM_CAP = '5';
      process.env.AI_COVERAGE_REPAIR_BATCH_SIZE = '50';
      const seenAtomCounts: number[] = [];
      const { fake } = fakeClient((prompt) => {
        if (!isRepairPrompt(prompt)) seenAtomCounts.push([...prompt.matchAll(/\[R3C-\d{3}\]/g)].length);
        return null;
      });
      __setGeminiClientFactoryForTests(() => fake);

      const res = await post({ document_context: [docWithAtoms(20)] });
      expect(res.status).toBe(200);
      expect(seenAtomCounts[0]).toBe(5); // ĐÚNG bằng cap, không phải 20
    });

    it('coverage cuối cùng vẫn tính trên TOÀN BỘ atom thật (20), không phải chỉ 5 atom đưa vào lần gọi đầu', async () => {
      process.env.AI_GENERATION_INITIAL_ATOM_CAP = '5';
      process.env.AI_COVERAGE_REPAIR_BATCH_SIZE = '50';
      // repair mặc định trả case KHÔNG cite atom nào -> coverage sẽ không đạt 100%,
      // đúng ý ta cần kiểm: total_atoms phải là 20 dù lần gọi đầu chỉ thấy 5.
      const { fake } = fakeClient(() => null);
      __setGeminiClientFactoryForTests(() => fake);

      const res = await post({ document_context: [docWithAtoms(20)] });
      const body = await res.json();
      expect(body.data.document_coverage.total_atoms).toBe(20);
    });

    it('tài liệu trong hạn mức cap: không có gì bị cắt, coverage đạt 100% ngay từ lần gọi đầu (không cần repair)', async () => {
      process.env.AI_GENERATION_INITIAL_ATOM_CAP = '30';
      const seenAtomCounts: number[] = [];
      const { fake } = fakeClient((prompt) => {
        if (!isRepairPrompt(prompt)) seenAtomCounts.push([...prompt.matchAll(/\[R3C-\d{3}\]/g)].length);
        return null;
      });
      __setGeminiClientFactoryForTests(() => fake);

      const res = await post({ document_context: [docWithAtoms(10)] });
      const body = await res.json();

      expect(seenAtomCounts[0]).toBe(10);
      expect(body.data.status).toBe('completed');
      expect(body.data.document_coverage.coverage_percent).toBe(100);
    });
  });

  // ==========================================================================
  // Category floor cap — phần thứ 3 của cùng bản sửa: chọn nhiều category không
  // còn tự nó đủ để vượt tràn output.
  // ==========================================================================
  describe('giới hạn "sàn theo category" cho lần gọi generation đầu tiên', () => {
    it('yêu cầu tối thiểu case/category trong prompt bị giảm khi chọn NHIỀU category', async () => {
      process.env.AI_GENERATION_CATEGORY_FLOOR_CAP = '10';
      const allCategories = ['positive', 'negative', 'boundary', 'ui_ux', 'compatibility', 'performance', 'security', 'integration', 'regression', 'accessibility', 'localization'];
      let seenPrompt = '';
      const { fake } = fakeClient((prompt) => {
        if (!isRepairPrompt(prompt)) seenPrompt = prompt;
        return null;
      });
      __setGeminiClientFactoryForTests(() => fake);

      await post({ selected_categories: allCategories });
      const match = /AT LEAST (\d+) cases per selected category/.exec(seenPrompt);
      expect(Number(match?.[1])).toBeLessThan(4); // 'standard' nominal là 4; 11 category vượt cap=10 nên phải bị giảm
    });

    it('chỉ chọn vài category (trường hợp phổ biến): không bị ảnh hưởng bởi cap mặc định', async () => {
      let seenPrompt = '';
      const { fake } = fakeClient((prompt) => {
        if (!isRepairPrompt(prompt)) seenPrompt = prompt;
        return null;
      });
      __setGeminiClientFactoryForTests(() => fake);

      await post({ selected_categories: ['positive', 'negative'] });
      const match = /AT LEAST (\d+) cases per selected category/.exec(seenPrompt);
      expect(Number(match?.[1])).toBe(4); // nominal 'standard' giữ nguyên
    });
  });

  // ==========================================================================
  // Regression: hành vi hiện có không bị phá vỡ bởi các thay đổi trên.
  // ==========================================================================
  describe('không phá vỡ hành vi hiện có', () => {
    it('lỗi xác thực (sai API key) vẫn dừng ngay, không đổi model, 503', async () => {
      const { fake, calls } = fakeClient(() => {
        throw httpError(403);
      });
      __setGeminiClientFactoryForTests(() => fake);

      const res = await post({});
      expect(res.status).toBe(503);
      expect(calls.filter((c) => !c.isRepair)).toHaveLength(1);
    });

    it('input không hợp lệ (thiếu cả requirement lẫn document) vẫn 400, không gọi Gemini', async () => {
      const { fake, calls } = fakeClient(() => null);
      __setGeminiClientFactoryForTests(() => fake);

      const res = await post({ requirement_description: '' });
      expect(res.status).toBe(400);
      expect(calls).toHaveLength(0);
    });

    it('phản hồi bị cắt cụt (truncated) vẫn được salvage + báo cáo issue, không mất trắng', async () => {
      // Mọi lần thử (kể cả sau khi retry hết maxRetriesPerModel VÀ đổi sang model
      // phụ) đều trả về CÙNG dạng bị cắt cụt — engine chỉ dùng bản "đã vá" làm
      // phương án CUỐI CÙNG sau khi không còn cách nào khác thành công trọn vẹn.
      const TRUNCATED = `{"analysis":null,"test_cases":[${JSON.stringify(testCase('TC_GEN_001'))},{"code":"TC_BROKEN`;
      const { fake } = fakeClient((prompt) => (isRepairPrompt(prompt) ? null : TRUNCATED));
      __setGeminiClientFactoryForTests(() => fake);

      const res = await post({});
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data.truncated).toBe(true);
      expect(body.data.issues.some((i: { code: string }) => i.code === 'truncated_response')).toBe(true);
      expect(body.data.test_cases.length).toBeGreaterThan(0);
    });
  });
});
