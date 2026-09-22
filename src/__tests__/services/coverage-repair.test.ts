/**
 * Integration test cho services/ai/coverage-repair.ts.
 *
 * Tai hien DUNG loi thuc te dang gap:
 *
 *      126 document atoms
 *      Generation pass dau tien chi cover 41  ->  32.5%
 *              ↓
 *      ung dung PHAT HIEN 85 atom bi bo sot
 *              ↓
 *      Gemini repair pass (theo batch)
 *              ↓
 *      merge + tinh lai coverage bang code
 *              ↓
 *      126/126 = 100%
 *
 * Gemini duoc gia lap: no doc danh sach atom con thieu TU CHINH PROMPT repair
 * va tra ve test case tuong ung — dung nhu mot model hoat dong binh thuong se lam.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { repairDocumentCoverage } from '@/services/ai/coverage-repair';
import { computeDocumentCoverage } from '@/services/documents/coverage';
import { __setGeminiClientFactoryForTests, type GeminiLikeClient } from '@/services/ai/gemini';
import type { ParsedDocument } from '@/models/validators/document';
import type { GeneratedTestCase } from '@/models/validators/test-case';

const TOTAL_ATOMS = 126;
const INITIALLY_COVERED = 41;

function makeDocument(): ParsedDocument {
  return {
    id: 'doc-1',
    source_type: 'document',
    title: 'FS + Figma + ERD',
    summary: 'Tài liệu tổng hợp cho module thanh toán',
    atoms: Array.from({ length: TOTAL_ATOMS }, (_, i) => ({
      atom_id: `ATOM_${String(i + 1).padStart(3, '0')}`,
      atom_type: 'rule' as const,
      label: `Yêu cầu ${i + 1}`,
      detail: `Mô tả chi tiết của yêu cầu ${i + 1}`,
      screen_or_section: `Section ${Math.floor(i / 20) + 1}`,
    })),
  };
}

function makeCase(code: string, atomIds: string[], title = `Test ${code}`): GeneratedTestCase {
  return {
    code,
    title,
    category: 'positive',
    priority: 'Normal',
    preconditions: ['Người dùng đã đăng nhập với vai trò Accountant'],
    test_data: { amount: '1500000' },
    steps: [
      { step_number: 1, action: 'Mở màn hình Thanh toán', expected_result: 'Màn hình Thanh toán hiển thị' },
      { step_number: 2, action: 'Nhập số tiền 1.500.000 vào ô Số tiền', expected_result: 'Ô Số tiền hiển thị 1.500.000' },
    ],
    final_expected_result: 'Giao dịch được ghi nhận ở trạng thái Chờ duyệt',
    source_requirement_ids: atomIds,
  };
}

/** Test case THUC SU kiem tra atom (co dan lai label + detail), de qua duoc
 * cong bang chung ngu nghia. Day cung la hinh dang ma mot lan generate tot tra ve. */
function coveringCases(atoms: { atom_id: string; label: string; detail: string }[]): GeneratedTestCase[] {
  return atoms.map((atom, i) => {
    const tc = makeCase(`TC_GEN_${String(i + 1).padStart(3, '0')}`, [atom.atom_id], `Kiểm tra ${atom.label}`);
    return {
      ...tc,
      steps: [...tc.steps, { step_number: 3, action: `Kiểm tra ${atom.label}`, expected_result: atom.detail }],
    };
  });
}

/** Rut danh sach atom con thieu (id + label + detail) ra khoi prompt repair. */
function uncoveredAtomsFromPrompt(prompt: string): { atom_id: string; label: string; detail: string }[] {
  const pattern = /^- atom_id: (\S+)\n {2}atom_type: .*\n {2}label: (.*)\n {2}detail: (.*)$/gm;
  return [...prompt.matchAll(pattern)].map((m) => ({ atom_id: m[1], label: m[2], detail: m[3] }));
}

/**
 * Gemini gia lap "hoat dong tot": voi moi atom con thieu, sinh dung 1 test case
 * co thuc, tham chieu chinh xac atom_id do.
 */
function cooperativeClient(): { client: GeminiLikeClient; callCount: () => number } {
  let calls = 0;
  let sequence = 1000;

  const client: GeminiLikeClient = {
    models: {
      generateContent: async (args) => {
        calls++;
        const atoms = uncoveredAtomsFromPrompt(String(args.contents));
        const testCases = atoms.map((atom) => {
          const tc = makeCase(`TC_REPAIR_${sequence++}`, [atom.atom_id], `Kiểm tra ${atom.label}`);
          // Một model hoạt động đúng sẽ dẫn lại nội dung yêu cầu trong bước test
          // — đó chính là thứ lớp bằng chứng ngữ nghĩa đi tìm.
          return {
            ...tc,
            steps: [
              ...tc.steps,
              { step_number: 3, action: `Kiểm tra ${atom.label}`, expected_result: atom.detail },
            ],
          };
        });
        return { text: JSON.stringify({ test_cases: testCases }) };
      },
      embedContent: async () => ({ embeddings: [{ values: [0] }] }),
    },
  };

  return { client, callCount: () => calls };
}

describe('repairDocumentCoverage — E2E 41/126 → 126/126', () => {
  beforeEach(() => {
    process.env.GOOGLE_GEMINI_API_KEY = 'test-key';
    process.env.AI_MODEL_PRIMARY = 'gemini-3.7-flash';
    process.env.AI_MODEL_FALLBACK_1 = 'gemini-3.6-flash';
    process.env.AI_MODEL_FALLBACK_2 = 'gemini-3.5-flash';
    process.env.GEMINI_BACKOFF_BASE_MS = '0';
    process.env.AI_COVERAGE_REPAIR_BATCH_SIZE = '35';
    process.env.AI_MAX_COVERAGE_REPAIR_ROUNDS = '4';
    // Khẳng định rõ: E2E này chạy VỚI cổng bằng chứng ngữ nghĩa bật, đúng như
    // production. Nếu không, test sẽ xanh ngay cả khi vòng repair chấp nhận các
    // case chỉ trích dẫn atom_id mà không kiểm tra gì.
    delete process.env.COVERAGE_REQUIRE_SEMANTIC_EVIDENCE;
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    __setGeminiClientFactoryForTests(null);
    vi.restoreAllMocks();
  });

  it('trang thai ban dau dung la 41/126 = 32.5%', () => {
    const doc = makeDocument();
    const initial = coveringCases(doc.atoms.slice(0, INITIALLY_COVERED));

    const coverage = computeDocumentCoverage([doc], initial)!;

    expect(coverage.covered_atoms).toBe(41);
    expect(coverage.total_atoms).toBe(126);
    expect(coverage.coverage_percent).toBe(32.5);
    expect(coverage.is_complete).toBe(false);
  });

  it('dua do phu tu 32.5% len 100% va bao stop_reason = complete', async () => {
    const doc = makeDocument();
    const initial = coveringCases(doc.atoms.slice(0, INITIALLY_COVERED));

    const { client, callCount } = cooperativeClient();
    __setGeminiClientFactoryForTests(() => client);

    const result = await repairDocumentCoverage({
      requirement_description: 'Module thanh toán nội bộ cho kế toán',
      documents: [doc],
      test_cases: initial,
      language: 'Tiếng Việt',
      detail_level: 'standard',
    });

    expect(result.document_coverage!.covered_atoms).toBe(126);
    expect(result.document_coverage!.total_atoms).toBe(126);
    expect(result.document_coverage!.coverage_percent).toBe(100);
    expect(result.document_coverage!.is_complete).toBe(true);
    expect(result.stop_reason).toBe('complete');
    // 85 atom / batch 35 => phai chia thanh nhieu lan goi, khong don 1 request khong lo.
    expect(callCount()).toBeGreaterThan(1);
  });

  it('GIU NGUYEN toan bo 41 test case ban dau (khong xoa coverage da co)', async () => {
    const doc = makeDocument();
    const initial = coveringCases(doc.atoms.slice(0, INITIALLY_COVERED));

    const { client } = cooperativeClient();
    __setGeminiClientFactoryForTests(() => client);

    const result = await repairDocumentCoverage({
      requirement_description: 'Module thanh toán nội bộ cho kế toán',
      documents: [doc],
      test_cases: initial,
      language: 'Tiếng Việt',
      detail_level: 'standard',
    });

    const finalCodes = new Set(result.test_cases.map((c) => c.code));
    for (const original of initial) {
      expect(finalCodes.has(original.code)).toBe(true);
    }
    expect(result.test_cases.length).toBeGreaterThanOrEqual(initial.length);
    // Ma test case duy nhat sau khi merge nhieu batch.
    expect(finalCodes.size).toBe(result.test_cases.length);
  });

  it('khong goi Gemini lan nao khi do phu da la 100%', async () => {
    const doc = makeDocument();
    const complete = coveringCases(doc.atoms);

    const { client, callCount } = cooperativeClient();
    __setGeminiClientFactoryForTests(() => client);

    const result = await repairDocumentCoverage({
      requirement_description: 'Module thanh toán',
      documents: [doc],
      test_cases: complete,
      language: 'Tiếng Việt',
      detail_level: 'standard',
    });

    expect(result.stop_reason).toBe('complete');
    expect(result.rounds_run).toBe(0);
    expect(callCount()).toBe(0);
  });

  it('tra ve stop_reason = no_documents khi khong dinh kem tai lieu', async () => {
    const result = await repairDocumentCoverage({
      requirement_description: 'Chỉ có mô tả, không có tài liệu',
      documents: [],
      test_cases: [makeCase('TC_001', [])],
      language: 'Tiếng Việt',
      detail_level: 'standard',
    });

    expect(result.stop_reason).toBe('no_documents');
    expect(result.document_coverage).toBeNull();
  });

  it('DUNG vong lap khi 1 vong khong cai thien duoc atom nao (chong lap vo han)', async () => {
    const doc = makeDocument();
    const initial = coveringCases([makeDocument().atoms[0]]);

    // Gemini "buong tay": luon tra ve case khong cover atom nao con thieu.
    let calls = 0;
    const stubbornClient: GeminiLikeClient = {
      models: {
        generateContent: async () => {
          calls++;
          return {
            text: JSON.stringify({
              test_cases: [makeCase(`TC_NOISE_${calls}`, ['ATOM_001'], `Case vô dụng ${calls}`)],
            }),
          };
        },
        embedContent: async () => ({ embeddings: [{ values: [0] }] }),
      },
    };
    __setGeminiClientFactoryForTests(() => stubbornClient);

    const result = await repairDocumentCoverage({
      requirement_description: 'Module thanh toán',
      documents: [doc],
      test_cases: initial,
      language: 'Tiếng Việt',
      detail_level: 'standard',
    });

    expect(result.stop_reason).toBe('no_progress');
    expect(result.document_coverage!.is_complete).toBe(false);
    // Dung sau dung 1 vong, khong dot quota cho 4 vong.
    expect(result.rounds_run).toBe(1);
  });

  it('KHONG tinh atom_id bia dat la da cover trong vong repair', async () => {
    const doc = makeDocument();
    const initial = coveringCases([makeDocument().atoms[0]]);

    const liarClient: GeminiLikeClient = {
      models: {
        generateContent: async () => ({
          text: JSON.stringify({
            test_cases: [
              makeCase('TC_FAKE_001', ['ATOM_BIA_DAT_1', 'ATOM_BIA_DAT_2'], 'Case với ID bịa đặt'),
            ],
          }),
        }),
        embedContent: async () => ({ embeddings: [{ values: [0] }] }),
      },
    };
    __setGeminiClientFactoryForTests(() => liarClient);

    const result = await repairDocumentCoverage({
      requirement_description: 'Module thanh toán',
      documents: [doc],
      test_cases: initial,
      language: 'Tiếng Việt',
      detail_level: 'standard',
    });

    expect(result.document_coverage!.covered_atoms).toBe(1); // van chi co ATOM_001
    expect(result.stop_reason).toBe('no_progress');
    expect(result.issues.some((i) => i.code === 'invalid_atom_id')).toBe(true);
    // Khong co ID bia dat nao lot vao ket qua cuoi.
    const allIds = result.test_cases.flatMap((c) => c.source_requirement_ids ?? []);
    expect(allIds.some((id) => id.startsWith('ATOM_BIA_DAT'))).toBe(false);
  });

  it('giu lai ket qua tung phan khi Gemini chet giua chung', async () => {
    const doc = makeDocument();
    const initial = coveringCases(doc.atoms.slice(0, 41));

    const deadClient: GeminiLikeClient = {
      models: {
        generateContent: async () => {
          const err = new Error('[503 Service Unavailable]') as Error & { status: number };
          err.status = 503;
          throw err;
        },
        embedContent: async () => ({ embeddings: [{ values: [0] }] }),
      },
    };
    __setGeminiClientFactoryForTests(() => deadClient);

    const result = await repairDocumentCoverage({
      requirement_description: 'Module thanh toán',
      documents: [doc],
      test_cases: initial,
      language: 'Tiếng Việt',
      detail_level: 'standard',
    });

    expect(result.stop_reason).toBe('provider_error');
    // KHONG vut bo 41 case da sinh duoc (muc 38).
    expect(result.test_cases).toHaveLength(41);
    expect(result.document_coverage!.covered_atoms).toBe(41);
    expect(result.provider_error).toBeTruthy();
    expect(result.provider_error).not.toMatch(/503|stack/i);
  });
});
