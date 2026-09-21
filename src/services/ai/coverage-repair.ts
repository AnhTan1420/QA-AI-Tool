// ============================================================================
// File: src/services/ai/coverage-repair.ts
// VONG SUA CHUA DO PHU TAI LIEU — do UNG DUNG dieu khien, khong phai AI.
// ----------------------------------------------------------------------------
//   Generate
//      ↓
//   Validate test case (Zod + ngu nghia)
//      ↓
//   Tinh document coverage BANG CODE
//      ↓
//   100%?  ──YES──> hoan tat
//      │NO
//      ↓
//   Gemini Coverage Repair (theo batch atom con thieu)
//      ↓ merge → tinh lai → lap lai
//
// Bat buoc phai co 2 co che chong lap vo han:
//   1. gioi han so vong (AI_MAX_COVERAGE_REPAIR_ROUNDS)
//   2. GUARD TIEN DO: mot vong khong tang duoc atom nao da cover thi dung ngay.
//      Neu khong, mot tai lieu co atom "khong the test duoc" se lam he thong
//      quay vong dot quota Gemini ma khong bao gio dat 100%.
// ============================================================================

import type { ParsedDocument } from '@/models/validators/document';
import { generatedTestCasesSchema, type GeneratedTestCase } from '@/models/validators/test-case';
import {
  computeDocumentCoverage,
  groupUncoveredAtomsIntoBatches,
  type DocumentCoverageResult,
} from '@/services/documents/coverage';
import { buildCoverageRepairPrompt } from './prompts/coverage-repair-agent';
import { buildTestCasesOnlyResponseSchema } from './prompts/generation-response-schema';
import { runGeminiTask } from './provider';
import { unwrapArrayResponse, validateAIJson } from './parse';
import { GeminiProviderError } from './errors';
import { getCoverageRepairBatchSize, getMaxCoverageRepairRounds } from './model-registry';
import {
  mergeTestCases,
  normalizeGeneratedTestCases,
  TestCaseCodeAllocator,
  type SemanticIssue,
} from './test-case-validation';

export type CoverageRepairInput = {
  requirement_description: string;
  documents: ParsedDocument[];
  test_cases: GeneratedTestCase[];
  language: string;
  detail_level: string;
  /** Ghi de so vong toi da (mac dinh lay tu env). */
  maxRounds?: number;
};

export type CoverageRepairResult = {
  test_cases: GeneratedTestCase[];
  document_coverage: DocumentCoverageResult | null;
  rounds_run: number;
  /** Ly do dung khi CHUA dat 100%. */
  stop_reason: 'complete' | 'no_documents' | 'max_rounds' | 'no_progress' | 'provider_error';
  issues: SemanticIssue[];
  /** Thong bao an toan de hien thi (khong lo chi tiet SDK). */
  provider_error?: string;
};

/** Ma test case goi y cho vong repair ke tiep (giu day so lien tuc). */
function nextCodeHint(testCases: GeneratedTestCase[]): string {
  const allocator = new TestCaseCodeAllocator(testCases);
  const lastCode = testCases[testCases.length - 1]?.code;
  // `allocate` voi `desired` da bi chiem se tra ve ma ke tiep cung tien to.
  return allocator.allocate(lastCode, 'TC_DOC');
}

/**
 * Chay vong repair cho toi khi do phu tai lieu dat 100% hoac het dieu kien.
 * Ham nay KHONG bao gio nem loi ra ngoai vi loi provider: no tra ve trang thai
 * `provider_error` kem bo test case da co, de route quyet dinh cach bao cao
 * (muc 38: khong duoc am tham vut bo ket qua tung phan).
 */
export async function repairDocumentCoverage(
  input: CoverageRepairInput,
): Promise<CoverageRepairResult> {
  const issues: SemanticIssue[] = [];
  let testCases = input.test_cases;
  let coverage = computeDocumentCoverage(input.documents, testCases);

  if (!coverage) {
    return { test_cases: testCases, document_coverage: null, rounds_run: 0, stop_reason: 'no_documents', issues };
  }
  if (coverage.is_complete) {
    return { test_cases: testCases, document_coverage: coverage, rounds_run: 0, stop_reason: 'complete', issues };
  }

  const maxRounds = input.maxRounds ?? getMaxCoverageRepairRounds();
  const batchSize = getCoverageRepairBatchSize();
  let round = 0;

  while (round < maxRounds && !coverage.is_complete) {
    round++;
    const coveredBefore = coverage.covered_atoms;
    console.info(
      `[Coverage] repair round ${round}/${maxRounds} — ${coverage.covered_atoms}/${coverage.total_atoms} (${coverage.coverage_percent}%), ${coverage.uncovered.length} uncovered`,
    );

    const batches = groupUncoveredAtomsIntoBatches(coverage.uncovered, batchSize);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
      const batch = batches[batchIndex];
      // Tap atom CON THIEU tai thoi diem nay — dung de loai bo case "khong dong
      // gop gi" o buoc merge ben duoi.
      const stillUncovered = new Set(coverage.uncovered.map((a) => a.atom_id));

      const prompt = buildCoverageRepairPrompt({
        requirement_description: input.requirement_description,
        documents: input.documents,
        existing_test_cases: testCases,
        uncovered_atoms: batch,
        covered_atoms: coverage.covered_atoms,
        total_atoms: coverage.total_atoms,
        coverage_percent: coverage.coverage_percent,
        language: input.language,
        detail_level: input.detail_level,
        next_code_hint: nextCodeHint(testCases),
      });

      let newCases: GeneratedTestCase[];
      try {
        const result = await runGeminiTask<GeneratedTestCase[]>({
          task: 'coverage_repair',
          prompt,
          responseSchema: buildTestCasesOnlyResponseSchema(),
          label: `repair round ${round}/${maxRounds}, batch ${batchIndex + 1}/${batches.length}`,
          validate: (raw) =>
            validateAIJson(generatedTestCasesSchema, unwrapArrayResponse(raw), 'coverage repair test cases'),
        });
        newCases = result.data;
      } catch (error) {
        const message =
          error instanceof GeminiProviderError
            ? error.userMessage
            : 'Không gọi được Gemini cho vòng sửa chữa độ phủ tài liệu.';
        console.error(`[Coverage] repair round ${round} batch ${batchIndex + 1} failed`);
        return {
          test_cases: testCases,
          document_coverage: coverage,
          rounds_run: round,
          stop_reason: 'provider_error',
          issues,
          provider_error: message,
        };
      }

      // 1) Bo atom_id bia dat + danh lai so step.
      const normalized = normalizeGeneratedTestCases(newCases, input.documents);
      issues.push(...normalized.issues);

      // 2) CHONG AN GIAN: chi giu case that su dong gop it nhat 1 atom dang thieu.
      //    Neu khong, Gemini co the tra ve cac case "bo sung" khong lien quan de
      //    lam day response ma coverage van dam chan tai cho.
      const contributing = normalized.test_cases.filter((testCase) =>
        (testCase.source_requirement_ids ?? []).some((id) => stillUncovered.has(id)),
      );

      const skipped = normalized.test_cases.length - contributing.length;
      if (skipped > 0) {
        console.warn(`[Coverage] repair dropped ${skipped} case(s) that covered no uncovered atom`);
      }

      // 3) Merge (giu nguyen toan bo case cu, cap ma moi khong trung).
      const merged = mergeTestCases(testCases, contributing);
      testCases = merged.test_cases;

      // 4) Tinh lai bang CODE sau moi batch — nguon su that duy nhat.
      coverage = computeDocumentCoverage(input.documents, testCases)!;
      if (coverage.is_complete) break;
    }

    if (coverage.is_complete) break;

    if (coverage.covered_atoms <= coveredBefore) {
      console.warn(
        `[Coverage] repair round ${round} made no progress (${coverage.covered_atoms}/${coverage.total_atoms}) — dừng để tránh lặp vô hạn`,
      );
      return { test_cases: testCases, document_coverage: coverage, rounds_run: round, stop_reason: 'no_progress', issues };
    }
  }

  return {
    test_cases: testCases,
    document_coverage: coverage,
    rounds_run: round,
    stop_reason: coverage.is_complete ? 'complete' : 'max_rounds',
    issues,
  };
}
