// ============================================================================
// File: src/services/ai/test-case-validation.ts
// Validate NGU NGHIA (semantic) + chuan hoa co hoc cho test case do AI sinh ra.
// ----------------------------------------------------------------------------
// Zod schema chi tra loi cau hoi "co dung HINH DANG khong?". No van cho qua:
//   • 2 test case trung code TC_LOGIN_001
//   • steps danh so 1, 2, 2, 5
//   • action = "..." / expected_result = "OK"
//   • source_requirement_ids tro toi 1 atom KHONG TON TAI
//   • 1 case gan 40 atom vao minh de "an gian" diem coverage
// File nay bat tat ca nhung truong hop do.
//
// Phan biet 2 nhom:
//   normalizeGeneratedTestCases()  -> SUA co hoc, khong lam thay doi y dinh test
//                                     (danh lai so step, khu trung code, bo ID bia)
//   validateGeneratedTestCases()   -> BAO CAO van de con lai, khong tu sua
// ============================================================================

import type { GeneratedTestCase, GenerationAnalysis } from '@/models/validators/test-case';
import type { ParsedDocument } from '@/models/validators/document';
import { collectAtomInventory, stripInvalidAtomReferences } from '@/services/documents/coverage';

export type SemanticIssueCode =
  | 'duplicate_test_case_code'
  | 'step_numbering_fixed'
  | 'empty_action'
  | 'empty_expected_result'
  | 'placeholder_action'
  | 'placeholder_expected_result'
  | 'invalid_atom_id'
  | 'coverage_padding'
  | 'planned_atom_not_covered'
  | 'planned_code_missing';

export type SemanticIssue = {
  code: SemanticIssueCode;
  severity: 'error' | 'warning';
  message: string;
  test_case_code?: string;
  atom_id?: string;
};

/**
 * So atom toi da 1 test case duoc phep tuyen bo la minh cover.
 * Co so: mot kich ban test that su lien quan den nhieu hon ~8 don vi yeu cau
 * la dau hieu cua "1 case chung chung gan bua moi atom vao de nang coverage"
 * (dieu muc 17 cam tuyet doi), chu khong phai 1 case duoc thiet ke tot.
 */
export const MAX_ATOMS_PER_TEST_CASE = 8;

const PLACEHOLDER_TOKENS = new Set([
  'n/a',
  'na',
  'tbd',
  'todo',
  'string',
  'abc',
  'xxx',
  '...',
  '-',
  '--',
  'none',
  'no',
  'ok',
  'test',
  'value',
  'step',
  'action',
  'expected',
  'expected result',
  'as expected',
  'works correctly',
  'work correctly',
  'hoat dong dung',
  'hoạt động đúng',
  'thanh cong',
  'thành công',
  'đúng như mong đợi',
  'không có lỗi',
]);

function isPlaceholder(value: string): boolean {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
  if (normalized.length === 0) return true;
  if (PLACEHOLDER_TOKENS.has(normalized)) return true;
  // Chuoi qua ngan de la 1 hanh dong/ket qua quan sat duoc.
  return normalized.length < 4;
}

// ── Cap phat ma test case ──────────────────────────────────────────────────

const CODE_PATTERN = /^(.*?)[_-](\d+)$/;

/**
 * Cap phat ma test case moi theo dung format TC_{MODULE}_{NNN}, TIEP TUC day so
 * hien co thay vi bat dau lai tu 001.
 *
 * Quan trong khi merge nhieu batch/vong repair: neu moi vong deu tu sinh
 * TC_LOGIN_001 thi bo case cuoi cung se day trung ma va ta se phai doi ten
 * hang loat — pha vo tham chieu ma nguoi dung/DB da thay o vong truoc.
 */
export class TestCaseCodeAllocator {
  private readonly used = new Set<string>();
  private readonly lastIndexByPrefix = new Map<string, number>();

  constructor(existing: GeneratedTestCase[] = []) {
    for (const testCase of existing) this.reserve(testCase.code);
  }

  reserve(code: string): void {
    if (!code) return;
    this.used.add(code);
    const match = code.match(CODE_PATTERN);
    if (!match) return;
    const [, prefix, digits] = match;
    const index = Number.parseInt(digits, 10);
    if (!Number.isFinite(index)) return;
    const previous = this.lastIndexByPrefix.get(prefix) ?? 0;
    if (index > previous) this.lastIndexByPrefix.set(prefix, index);
  }

  has(code: string): boolean {
    return this.used.has(code);
  }

  /** Tra ve `desired` neu con trong, nguoc lai cap ma ke tiep cung tien to. */
  allocate(desired: string | undefined, fallbackPrefix = 'TC_GEN'): string {
    const candidate = desired?.trim();
    if (candidate && !this.used.has(candidate)) {
      this.reserve(candidate);
      return candidate;
    }

    const match = candidate?.match(CODE_PATTERN);
    const prefix = match ? match[1] : fallbackPrefix;
    const padding = match ? match[2].length : 3;

    let next = (this.lastIndexByPrefix.get(prefix) ?? 0) + 1;
    let code = `${prefix}_${String(next).padStart(padding, '0')}`;
    while (this.used.has(code)) {
      next++;
      code = `${prefix}_${String(next).padStart(padding, '0')}`;
    }
    this.reserve(code);
    return code;
  }
}

// ── Chuan hoa co hoc ───────────────────────────────────────────────────────

export type NormalizeResult = {
  test_cases: GeneratedTestCase[];
  issues: SemanticIssue[];
};

/**
 * Sua cac loi CO HOC ma viec tu dong sua KHONG lam thay doi y dinh test:
 *   1. danh lai step_number thanh 1..n theo dung thu tu AI da xuat
 *   2. doi ten case trung ma (giu case dau tien nguyen ven)
 *   3. bo atom_id bia dat + khu trung id
 * Moi thay doi deu duoc bao cao lai trong `issues` de con audit.
 */
export function normalizeGeneratedTestCases(
  testCases: GeneratedTestCase[],
  documents?: ParsedDocument[] | null,
): NormalizeResult {
  const issues: SemanticIssue[] = [];

  const { test_cases: withValidAtoms, removed } = stripInvalidAtomReferences(testCases, documents);
  for (const invalid of removed) {
    issues.push({
      code: 'invalid_atom_id',
      severity: 'warning',
      atom_id: invalid.atom_id,
      message: `AI tham chiếu atom_id không tồn tại trong tài liệu: "${invalid.atom_id}" (ở ${invalid.referenced_by.join(', ')}). Đã loại bỏ.`,
    });
  }

  const allocator = new TestCaseCodeAllocator();
  const normalized = withValidAtoms.map((testCase, index) => {
    const desired = testCase.code?.trim() || `TC_GEN_${String(index + 1).padStart(3, '0')}`;
    const code = allocator.allocate(desired);
    if (code !== desired) {
      issues.push({
        code: 'duplicate_test_case_code',
        severity: 'warning',
        test_case_code: desired,
        message: `Trùng mã test case "${desired}" — đã đổi thành "${code}".`,
      });
    }

    const needsRenumber = testCase.steps.some((step, i) => step.step_number !== i + 1);
    if (needsRenumber) {
      issues.push({
        code: 'step_numbering_fixed',
        severity: 'warning',
        test_case_code: code,
        message: `Số thứ tự step không tuần tự — đã đánh lại 1..${testCase.steps.length}.`,
      });
    }

    // CHONG AN GIAN COVERAGE (muc 17/24): mot case om qua nhieu atom bi cat
    // xuong nguong cho phep. Cac atom bi cat KHONG bien mat — chung quay ve
    // trang thai "uncovered" va se duoc vong repair sinh case RIENG, dung muc
    // tieu, thay vi duoc 1 case chung chung nhan vo ma khong thuc su test.
    const declaredAtomIds = [...new Set(testCase.source_requirement_ids ?? [])];
    const keptAtomIds = declaredAtomIds.slice(0, MAX_ATOMS_PER_TEST_CASE);
    if (declaredAtomIds.length > keptAtomIds.length) {
      issues.push({
        code: 'coverage_padding',
        severity: 'warning',
        test_case_code: code,
        message: `Test case ${code} khai báo cover ${declaredAtomIds.length} atom (tối đa ${MAX_ATOMS_PER_TEST_CASE}). Đã cắt xuống ${keptAtomIds.length}; các atom còn lại sẽ được vòng repair sinh case riêng.`,
      });
    }

    return {
      ...testCase,
      code,
      steps: testCase.steps.map((step, i) => ({ ...step, step_number: i + 1 })),
      ...(testCase.source_requirement_ids ? { source_requirement_ids: keptAtomIds } : {}),
    };
  });

  return { test_cases: normalized, issues };
}

// ── Validate ngu nghia ─────────────────────────────────────────────────────

export type SemanticValidationResult = {
  issues: SemanticIssue[];
  errors: SemanticIssue[];
  warnings: SemanticIssue[];
  is_valid: boolean;
};

/**
 * Kiem tra cac dieu kien KHONG the tu dong sua. Goi SAU normalizeGeneratedTestCases().
 */
export function validateGeneratedTestCases(
  testCases: GeneratedTestCase[],
  context: {
    documents?: ParsedDocument[] | null;
    analysis?: GenerationAnalysis | null;
  } = {},
): SemanticValidationResult {
  const issues: SemanticIssue[] = [];
  const inventory = collectAtomInventory(context.documents);
  const codes = new Set(testCases.map((t) => t.code));

  // 1) Trung ma (con sot lai sau normalize = loi that su).
  const seenCodes = new Set<string>();
  for (const testCase of testCases) {
    if (seenCodes.has(testCase.code)) {
      issues.push({
        code: 'duplicate_test_case_code',
        severity: 'error',
        test_case_code: testCase.code,
        message: `Mã test case bị trùng: ${testCase.code}.`,
      });
    }
    seenCodes.add(testCase.code);
  }

  for (const testCase of testCases) {
    // 2) Step: danh so tuan tu + noi dung khong rong/placeholder.
    testCase.steps.forEach((step, index) => {
      if (step.step_number !== index + 1) {
        issues.push({
          code: 'step_numbering_fixed',
          severity: 'error',
          test_case_code: testCase.code,
          message: `Step thứ ${index + 1} mang số ${step.step_number} — số thứ tự phải tuần tự 1..n.`,
        });
      }
      if (!step.action?.trim()) {
        issues.push({
          code: 'empty_action',
          severity: 'error',
          test_case_code: testCase.code,
          message: `Step ${index + 1} không có action.`,
        });
      } else if (isPlaceholder(step.action)) {
        issues.push({
          code: 'placeholder_action',
          severity: 'warning',
          test_case_code: testCase.code,
          message: `Step ${index + 1} có action chung chung/placeholder: "${step.action.trim()}".`,
        });
      }

      if (!step.expected_result?.trim()) {
        issues.push({
          code: 'empty_expected_result',
          severity: 'error',
          test_case_code: testCase.code,
          message: `Step ${index + 1} không có expected_result.`,
        });
      } else if (isPlaceholder(step.expected_result)) {
        issues.push({
          code: 'placeholder_expected_result',
          severity: 'warning',
          test_case_code: testCase.code,
          message: `Step ${index + 1} có expected_result không quan sát được: "${step.expected_result.trim()}".`,
        });
      }
    });

    // 3) ID khong hop le (sau normalize thi khong con, nhung van kiem tra lai).
    for (const id of testCase.source_requirement_ids ?? []) {
      if (inventory.byId.size > 0 && !inventory.byId.has(id)) {
        issues.push({
          code: 'invalid_atom_id',
          severity: 'error',
          test_case_code: testCase.code,
          atom_id: id,
          message: `Test case ${testCase.code} tham chiếu atom_id không tồn tại: ${id}.`,
        });
      }
    }

    // 4) Chong "an gian coverage": 1 case om qua nhieu atom.
    // Luoi an toan: normalizeGeneratedTestCases() da cat nguong nay tu truoc,
    // nen neu van con tuc la co duong di nao bo qua buoc chuan hoa.
    const atomCount = new Set(testCase.source_requirement_ids ?? []).size;
    if (atomCount > MAX_ATOMS_PER_TEST_CASE) {
      issues.push({
        code: 'coverage_padding',
        severity: 'error',
        test_case_code: testCase.code,
        message: `Test case ${testCase.code} khai báo cover ${atomCount} atom (tối đa ${MAX_ATOMS_PER_TEST_CASE}). Đây là dấu hiệu gán atom vào một case chung chung để nâng coverage — hãy tách thành các case riêng.`,
      });
    }
  }

  // 5) analysis.document_atom_plan phai KHOP voi test case thuc te (muc 27).
  const plan = context.analysis?.document_atom_plan ?? [];
  if (plan.length > 0) {
    const coveredAtomIds = new Set<string>();
    for (const testCase of testCases) {
      for (const id of testCase.source_requirement_ids ?? []) coveredAtomIds.add(id);
    }

    for (const entry of plan) {
      const atomId = entry.atom_id?.trim();
      const plannedCode = entry.planned_test_case_code?.trim();

      if (atomId && inventory.byId.has(atomId) && !coveredAtomIds.has(atomId)) {
        issues.push({
          code: 'planned_atom_not_covered',
          severity: 'error',
          atom_id: atomId,
          message: `AI lên kế hoạch cover atom "${atomId}" nhưng không test case nào thực sự tham chiếu nó.`,
        });
      }
      if (plannedCode && !codes.has(plannedCode)) {
        issues.push({
          code: 'planned_code_missing',
          severity: 'warning',
          test_case_code: plannedCode,
          message: `Kế hoạch nhắc tới test case "${plannedCode}" nhưng mã này không có trong kết quả cuối.`,
        });
      }
    }
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return { issues, errors, warnings, is_valid: errors.length === 0 };
}

/**
 * Gop test case moi (tu repair/enhance) vao bo hien co:
 *   • giu NGUYEN bo case cu (khong bao gio xoa coverage da co)
 *   • cap ma moi khong trung, tiep tuc day so hien tai
 *   • danh lai so step cho case moi
 *   • cat bo phan tuyen bo atom vuot nguong chong-an-gian
 */
export function mergeTestCases(
  existing: GeneratedTestCase[],
  additions: GeneratedTestCase[],
): { test_cases: GeneratedTestCase[]; added: GeneratedTestCase[] } {
  const allocator = new TestCaseCodeAllocator(existing);
  const existingTitles = new Set(existing.map((t) => t.title.trim().toLowerCase()));
  const added: GeneratedTestCase[] = [];

  for (const candidate of additions) {
    const title = candidate.title?.trim().toLowerCase() ?? '';
    // Trung y het kich ban da co -> bo qua, tranh nhan ban scenario giua cac batch.
    if (title && existingTitles.has(title)) continue;
    existingTitles.add(title);

    const uniqueAtomIds = [...new Set(candidate.source_requirement_ids ?? [])].slice(
      0,
      MAX_ATOMS_PER_TEST_CASE,
    );

    added.push({
      ...candidate,
      code: allocator.allocate(candidate.code),
      steps: candidate.steps.map((step, index) => ({ ...step, step_number: index + 1 })),
      source_requirement_ids: uniqueAtomIds,
    });
  }

  return { test_cases: [...existing, ...added], added };
}

/**
 * Chong "tut lui do phu" sau khi Enhance.
 *
 * Enhance duoc phep sua/xoa case trung lap, nhung KHONG duoc phep lam mat mot
 * atom da tung duoc cover. Ham nay so sanh atom-level truoc/sau: voi moi atom
 * bi mat, no tim lai chinh cac test case GOC dang cover atom do va dua chung
 * tro lai ket qua (neu chung da bien mat).
 *
 * Deterministic, khong ton them 1 luot goi AI — day la ly do no nam o tang ung
 * dung chu khong phai o prompt.
 */
export function preserveCoverageRegressions(
  before: GeneratedTestCase[],
  after: GeneratedTestCase[],
  documents?: ParsedDocument[] | null,
): { test_cases: GeneratedTestCase[]; restored: GeneratedTestCase[]; lost_atom_ids: string[] } {
  const inventory = collectAtomInventory(documents);
  if (inventory.byId.size === 0) return { test_cases: after, restored: [], lost_atom_ids: [] };

  const atomsIn = (cases: GeneratedTestCase[]) => {
    const set = new Set<string>();
    for (const testCase of cases) {
      for (const id of testCase.source_requirement_ids ?? []) {
        if (inventory.byId.has(id)) set.add(id);
      }
    }
    return set;
  };

  const coveredBefore = atomsIn(before);
  const coveredAfter = atomsIn(after);
  const lost = [...coveredBefore].filter((id) => !coveredAfter.has(id));
  if (lost.length === 0) return { test_cases: after, restored: [], lost_atom_ids: [] };

  const presentCodes = new Set(after.map((t) => t.code));
  const restored: GeneratedTestCase[] = [];
  const lostSet = new Set(lost);

  for (const original of before) {
    if (presentCodes.has(original.code)) continue;
    const coversLost = (original.source_requirement_ids ?? []).some((id) => lostSet.has(id));
    if (!coversLost) continue;
    restored.push(original);
    presentCodes.add(original.code);
  }

  return { test_cases: [...after, ...restored], restored, lost_atom_ids: lost };
}
