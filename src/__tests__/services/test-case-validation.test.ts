/**
 * Unit tests cho services/ai/test-case-validation.ts.
 *
 * Zod chi kiem tra HINH DANG. Cac test duoi day kiem tra nhung thu Zod cho qua:
 * ma trung, step danh so sai, ID bia dat, va thu doan "gan ca dong atom vao 1
 * case chung chung de nang coverage".
 */
import { describe, it, expect } from 'vitest';
import {
  TestCaseCodeAllocator,
  MAX_ATOMS_PER_TEST_CASE,
  mergeTestCases,
  normalizeGeneratedTestCases,
  preserveCoverageRegressions,
  validateGeneratedTestCases,
} from '@/services/ai/test-case-validation';
import type { ParsedDocument } from '@/models/validators/document';
import type { GeneratedTestCase } from '@/models/validators/test-case';

function makeDocument(atomCount: number): ParsedDocument {
  return {
    id: 'doc-1',
    source_type: 'figma',
    title: 'Login design',
    summary: 'Man hinh dang nhap',
    atoms: Array.from({ length: atomCount }, (_, i) => ({
      atom_id: `FIG_${i + 1}`,
      atom_type: 'screen_element' as const,
      label: `Element ${i + 1}`,
      detail: `Chi tiet ${i + 1}`,
      screen_or_section: 'Login',
    })),
  };
}

function makeCase(overrides: Partial<GeneratedTestCase> & { code: string }): GeneratedTestCase {
  return {
    title: `Test ${overrides.code}`,
    category: 'positive',
    priority: 'Normal',
    preconditions: [],
    test_data: {},
    steps: [{ step_number: 1, action: 'Mở màn hình Login', expected_result: 'Màn hình hiển thị' }],
    final_expected_result: 'Đăng nhập thành công',
    source_requirement_ids: [],
    ...overrides,
  };
}

describe('normalizeGeneratedTestCases', () => {
  it('danh lai step_number thanh 1..n', () => {
    const result = normalizeGeneratedTestCases([
      makeCase({
        code: 'TC_LOGIN_001',
        steps: [
          { step_number: 1, action: 'A', expected_result: 'RA' },
          { step_number: 2, action: 'B', expected_result: 'RB' },
          { step_number: 2, action: 'C', expected_result: 'RC' },
          { step_number: 5, action: 'D', expected_result: 'RD' },
        ],
      }),
    ]);

    expect(result.test_cases[0].steps.map((s) => s.step_number)).toEqual([1, 2, 3, 4]);
    expect(result.issues.some((i) => i.code === 'step_numbering_fixed')).toBe(true);
  });

  it('doi ten ma test case bi trung, giu case dau tien nguyen ven', () => {
    const result = normalizeGeneratedTestCases([
      makeCase({ code: 'TC_LOGIN_001' }),
      makeCase({ code: 'TC_LOGIN_001' }),
      makeCase({ code: 'TC_LOGIN_001' }),
    ]);

    const codes = result.test_cases.map((c) => c.code);
    expect(codes[0]).toBe('TC_LOGIN_001');
    expect(new Set(codes).size).toBe(3);
    expect(result.issues.filter((i) => i.code === 'duplicate_test_case_code')).toHaveLength(2);
  });

  it('loai bo atom_id khong ton tai trong tai lieu', () => {
    const doc = makeDocument(2);
    const result = normalizeGeneratedTestCases(
      [makeCase({ code: 'TC_001', source_requirement_ids: ['FIG_1', 'BIA_DAT'] })],
      [doc],
    );

    expect(result.test_cases[0].source_requirement_ids).toEqual(['FIG_1']);
    expect(result.issues.some((i) => i.code === 'invalid_atom_id' && i.atom_id === 'BIA_DAT')).toBe(true);
  });

  it('cat bot khi 1 case om qua nhieu atom (chong an gian coverage)', () => {
    const doc = makeDocument(30);
    const allIds = doc.atoms.map((a) => a.atom_id);

    const result = normalizeGeneratedTestCases(
      [makeCase({ code: 'TC_GENERIC_001', title: 'Verify document requirements', source_requirement_ids: allIds })],
      [doc],
    );

    expect(result.test_cases[0].source_requirement_ids).toHaveLength(MAX_ATOMS_PER_TEST_CASE);
    expect(result.issues.some((i) => i.code === 'coverage_padding')).toBe(true);
  });
});

describe('validateGeneratedTestCases', () => {
  it('bao loi khi con ma trung sau chuan hoa', () => {
    const result = validateGeneratedTestCases([
      makeCase({ code: 'TC_001' }),
      makeCase({ code: 'TC_001' }),
    ]);

    expect(result.is_valid).toBe(false);
    expect(result.errors.some((i) => i.code === 'duplicate_test_case_code')).toBe(true);
  });

  it('bao loi khi step khong danh so tuan tu', () => {
    const result = validateGeneratedTestCases([
      makeCase({
        code: 'TC_001',
        steps: [
          { step_number: 1, action: 'A', expected_result: 'RA' },
          { step_number: 3, action: 'B', expected_result: 'RB' },
        ],
      }),
    ]);

    expect(result.is_valid).toBe(false);
    expect(result.errors.some((i) => i.code === 'step_numbering_fixed')).toBe(true);
  });

  it('canh bao expected_result chung chung/khong quan sat duoc', () => {
    const result = validateGeneratedTestCases([
      makeCase({
        code: 'TC_001',
        steps: [{ step_number: 1, action: 'Nhấn nút Đăng nhập', expected_result: 'OK' }],
      }),
    ]);

    expect(result.warnings.some((i) => i.code === 'placeholder_expected_result')).toBe(true);
  });

  it('bao loi khi con atom_id khong hop le', () => {
    const doc = makeDocument(2);
    const result = validateGeneratedTestCases(
      [makeCase({ code: 'TC_001', source_requirement_ids: ['KHONG_TON_TAI'] })],
      { documents: [doc] },
    );

    expect(result.is_valid).toBe(false);
    expect(result.errors.some((i) => i.code === 'invalid_atom_id')).toBe(true);
  });

  it('bao loi khi ke hoach (document_atom_plan) co atom khong duoc case nao cover', () => {
    const doc = makeDocument(3);
    const result = validateGeneratedTestCases(
      [makeCase({ code: 'TC_001', source_requirement_ids: ['FIG_1'] })],
      {
        documents: [doc],
        analysis: {
          document_atom_plan: [
            { atom_id: 'FIG_1', planned_test_case_code: 'TC_001' },
            { atom_id: 'FIG_2', planned_test_case_code: 'TC_002' },
          ],
        },
      },
    );

    expect(result.errors.some((i) => i.code === 'planned_atom_not_covered' && i.atom_id === 'FIG_2')).toBe(true);
  });

  it('canh bao khi planned_test_case_code khong ton tai trong ket qua cuoi', () => {
    const doc = makeDocument(1);
    const result = validateGeneratedTestCases(
      [makeCase({ code: 'TC_001', source_requirement_ids: ['FIG_1'] })],
      {
        documents: [doc],
        analysis: { document_atom_plan: [{ atom_id: 'FIG_1', planned_test_case_code: 'TC_999' }] },
      },
    );

    expect(result.warnings.some((i) => i.code === 'planned_code_missing')).toBe(true);
  });

  it('bo test case dung chuan thi khong co loi nao', () => {
    const doc = makeDocument(2);
    const result = validateGeneratedTestCases(
      [
        makeCase({ code: 'TC_LOGIN_001', source_requirement_ids: ['FIG_1'] }),
        makeCase({ code: 'TC_LOGIN_002', source_requirement_ids: ['FIG_2'] }),
      ],
      { documents: [doc] },
    );

    expect(result.is_valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('TestCaseCodeAllocator', () => {
  it('tiep tuc day so thay vi bat dau lai tu 001', () => {
    const allocator = new TestCaseCodeAllocator([
      makeCase({ code: 'TC_LOGIN_001' }),
      makeCase({ code: 'TC_LOGIN_012' }),
    ]);

    expect(allocator.allocate('TC_LOGIN_001')).toBe('TC_LOGIN_013');
    expect(allocator.allocate('TC_LOGIN_001')).toBe('TC_LOGIN_014');
  });

  it('giu nguyen ma con trong', () => {
    const allocator = new TestCaseCodeAllocator([makeCase({ code: 'TC_LOGIN_001' })]);
    expect(allocator.allocate('TC_PAYMENT_001')).toBe('TC_PAYMENT_001');
  });
});

describe('mergeTestCases', () => {
  it('giu nguyen case cu va cap ma moi khong trung', () => {
    const existing = [makeCase({ code: 'TC_LOGIN_001', source_requirement_ids: ['FIG_1'] })];
    const additions = [makeCase({ code: 'TC_LOGIN_001', title: 'Case moi hoan toan' })];

    const merged = mergeTestCases(existing, additions);

    expect(merged.test_cases).toHaveLength(2);
    expect(merged.test_cases[0].code).toBe('TC_LOGIN_001');
    expect(merged.test_cases[1].code).toBe('TC_LOGIN_002');
    expect(merged.test_cases[0].source_requirement_ids).toEqual(['FIG_1']); // coverage cu con nguyen
  });

  it('bo qua case moi trung y het tieu de (chong nhan ban giua cac batch)', () => {
    const existing = [makeCase({ code: 'TC_001', title: 'Kiểm tra nút Đăng nhập bị vô hiệu hóa' })];
    const additions = [makeCase({ code: 'TC_099', title: 'kiểm tra nút đăng nhập bị vô hiệu hóa  ' })];

    const merged = mergeTestCases(existing, additions);
    expect(merged.added).toHaveLength(0);
    expect(merged.test_cases).toHaveLength(1);
  });

  it('cat so atom cua case moi xuong nguong cho phep', () => {
    const many = Array.from({ length: 20 }, (_, i) => `FIG_${i + 1}`);
    const merged = mergeTestCases([], [makeCase({ code: 'TC_001', source_requirement_ids: many })]);

    expect(merged.test_cases[0].source_requirement_ids).toHaveLength(MAX_ATOMS_PER_TEST_CASE);
  });
});

describe('preserveCoverageRegressions', () => {
  it('khoi phuc case goc khi Enhance lam mat atom da cover', () => {
    const doc = makeDocument(3);
    const before = [
      makeCase({ code: 'TC_001', source_requirement_ids: ['FIG_1'] }),
      makeCase({ code: 'TC_002', source_requirement_ids: ['FIG_2'] }),
      makeCase({ code: 'TC_003', source_requirement_ids: ['FIG_3'] }),
    ];
    // Enhance "quen" tra lai TC_002 -> FIG_2 mat coverage.
    const after = [before[0], before[2]];

    const result = preserveCoverageRegressions(before, after, [doc]);

    expect(result.lost_atom_ids).toEqual(['FIG_2']);
    expect(result.restored.map((c) => c.code)).toEqual(['TC_002']);
    expect(result.test_cases).toHaveLength(3);
  });

  it('khong khoi phuc gi khi atom van con duoc case khac cover', () => {
    const doc = makeDocument(2);
    const before = [
      makeCase({ code: 'TC_001', source_requirement_ids: ['FIG_1'] }),
      makeCase({ code: 'TC_002', source_requirement_ids: ['FIG_1', 'FIG_2'] }),
    ];
    const after = [before[1]]; // TC_001 bi go nhung FIG_1 van duoc TC_002 cover

    const result = preserveCoverageRegressions(before, after, [doc]);

    expect(result.lost_atom_ids).toHaveLength(0);
    expect(result.test_cases).toHaveLength(1);
  });
});
