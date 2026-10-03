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
// Chong lap vo han + chong lang phi (5 co che):
//   1. gioi han so vong (AI_MAX_COVERAGE_REPAIR_ROUNDS)
//   2. GUARD TIEN DO: mot vong khong tang duoc atom nao da cover thi dung ngay.
//   3. ATOM KET: atom da duoc gui >= MAX_ATOM_ATTEMPTS lan ma van chua cover thi
//      KHONG gui lai (gui lai y het chi cho ket qua tuong duong, ton token).
//   4. NGAN SACH: truoc MOI batch hoi ExecutionBudget; het thi dung va tra phan da lam
//      (stop_reason 'budget_exhausted') thay vi bi nen tang giet giua chung.
//   5. CHIA NHO khi 1 batch bi cat cut/timeout/qua lon (thay vi bo ca vong).
// Prompt chi mang atom CUA BATCH + atom cung section (scopeDocumentsToAtoms), khong
// phai toan bo tai lieu moi lan goi; kich thuoc batch/timeout/maxOutputTokens duoc
// tinh tu uoc luong output (output-budget.ts).
// ============================================================================

import type { ParsedDocument } from '@/models/validators/document';
import { z } from 'zod';
import { generatedTestCaseSchema, type GeneratedTestCase } from '@/models/validators/test-case';
import {
  computeDocumentCoverage,
  collectAtomInventory,
  groupUncoveredAtomsIntoBatches,
  type DocumentCoverageResult,
} from '@/services/documents/coverage';
import { assessMappingEvidence, buildTestCaseHaystack } from '@/services/documents/coverage-evidence';
import { buildCoverageRepairPrompt } from './prompts/coverage-repair-agent';
import { buildTestCasesOnlyResponseSchema } from './prompts/generation-response-schema';
import { runGeminiTask } from './provider';
import {
  getAssumedOutputTokensPerSecond,
  getCoverageRepairBatchSize,
  getGenerationMaxOutputTokens,
  getGenerationRequestTimeoutMs,
  getMaxCoverageRepairRounds,
} from './model-registry';
import { unwrapArrayResponse, validateAIJson } from './parse';
import { GeminiProviderError, type FailureCode } from './errors';
import { MAX_SPLIT_DEPTH, isSplittableFailure } from './retry-policy';
import type { ExecutionBudget } from './execution-budget';
import {
  TOKENS_PER_CASE,
  computeAttemptTimeoutMs,
  maxOutputTokensFor,
  planRepairBatchSize,
} from './output-budget';
import { normalizeDetailLevel } from './quality-standards';
import { scopeDocumentsToAtoms } from './source-context';
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
  /** Ngan sach thoi gian CHUNG cua request. Khong co = khong gioi han (chi dung trong test). */
  budget?: ExecutionBudget;
};

/** Nho hon nguong nay thi khong dang bat dau vong repair (1 batch nho van can ~vai chuc giay). */
export const MIN_REPAIR_BUDGET_MS = 30_000;
/** Atom duoc gui toi da bay nhieu lan ma van chua cover thi bi coi la "ket". */
export const MAX_ATOM_ATTEMPTS = 2;
/** Chi tiet toi da trong "index case da co" gui kem moi batch. */
const MAX_INDEX_CASES = 150;


export type CoverageRepairResult = {
  test_cases: GeneratedTestCase[];
  document_coverage: DocumentCoverageResult | null;
  rounds_run: number;
  /** Ly do dung khi CHUA dat 100%. */
  stop_reason: 'complete' | 'no_documents' | 'max_rounds' | 'no_progress' | 'provider_error' | 'budget_exhausted';
  issues: SemanticIssue[];
  models_used: string[];
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
    return { test_cases: testCases, document_coverage: null, rounds_run: 0, stop_reason: 'no_documents', issues, models_used: [] };
  }
  if (coverage.is_complete) {
    return { test_cases: testCases, document_coverage: coverage, rounds_run: 0, stop_reason: 'complete', issues, models_used: [] };
  }

  const maxRounds = input.maxRounds ?? getMaxCoverageRepairRounds();
  const maxOut = getGenerationMaxOutputTokens();
  const batchSize = planRepairBatchSize({
    detailLevel: input.detail_level,
    maxOutputTokens: maxOut,
    configuredSize: getCoverageRepairBatchSize(),
  });
  const modelsUsed = new Set<string>();
  const attempts = new Map<string, number>();
  let round = 0;

  const finish = (stop_reason: CoverageRepairResult['stop_reason'], provider_error?: string): CoverageRepairResult => ({
    test_cases: testCases,
    document_coverage: coverage,
    rounds_run: round,
    stop_reason,
    issues,
    models_used: [...modelsUsed],
    ...(provider_error ? { provider_error } : {}),
  });

  /** Stop with no_progress, telling the user WHICH atoms were given up on (not just that we stopped). */
  const finishNoProgress = (): CoverageRepairResult => {
    const stuck = (coverage?.uncovered ?? []).filter((a) => (attempts.get(a.atom_id) ?? 0) >= MAX_ATOM_ATTEMPTS);
    if (stuck.length > 0 && !issues.some((i) => i.code === 'repair_atoms_stuck')) {
      issues.push({
        code: 'repair_atoms_stuck',
        severity: 'warning',
        message: `${stuck.length} atom vẫn chưa được cover sau ${MAX_ATOM_ATTEMPTS} lần thử (${stuck.slice(0, 5).map((a) => a.atom_id).join(', ')}${stuck.length > 5 ? ', …' : ''}) — dừng gửi lại cùng một yêu cầu.`,
      });
    }
    return finish('no_progress');
  };

  const perAtomTokens = TOKENS_PER_CASE[normalizeDetailLevel(input.detail_level)] / 1.5;

  while (round < maxRounds && !coverage.is_complete) {
    round++;
    const coveredBefore = coverage.covered_atoms;
    console.info(
      `[Coverage] repair round ${round}/${maxRounds} — ${coverage.covered_atoms}/${coverage.total_atoms} (${coverage.coverage_percent}%), ${coverage.uncovered.length} uncovered`,
    );

    // Atoms already attempted MAX_ATOM_ATTEMPTS times without being covered are not re-sent.
    const eligible = coverage.uncovered.filter((a) => (attempts.get(a.atom_id) ?? 0) < MAX_ATOM_ATTEMPTS);
    if (eligible.length === 0) {
      return finishNoProgress();
    }

    const queue = groupUncoveredAtomsIntoBatches(eligible, batchSize).map((atoms) => ({ atoms, depth: 0 }));
    let batchNumber = 0;

    while (queue.length > 0) {
      const queued = queue.shift()!;
      const batch = queued.atoms;
      batchNumber++;

      const estOut = Math.ceil(batch.length * perAtomTokens) + 600;
      const timeoutMs = computeAttemptTimeoutMs(estOut, {
        tokensPerSecond: getAssumedOutputTokensPerSecond(),
        ceilingMs: getGenerationRequestTimeoutMs(),
      });
      const minAttemptMs = Math.round(timeoutMs * 0.5);
      // Het ngan sach: dung NGAY va tra phan da lam (khong bi giet giua chung).
      if (input.budget && !input.budget.canAfford(minAttemptMs)) {
        console.warn(`[Coverage] repair dừng: không đủ ngân sách thời gian cho batch kế tiếp (${Math.round(input.budget.usableMs())}ms còn lại)`);
        return finish('budget_exhausted');
      }

      // Tap atom CON THIEU tai thoi diem nay — dung de loai bo case "khong dong
      // gop gi" o buoc merge ben duoi.
      const stillUncovered = new Set(coverage.uncovered.map((a) => a.atom_id));
      const batchIds = new Set(batch.map((a) => a.atom_id));

      // Chi gui cac case co lien quan toi batch (cung atom) truoc, roi case moi nhat.
      const related = testCases.filter((tc) => (tc.source_requirement_ids ?? []).some((id) => batchIds.has(id)));
      const relatedCodes = new Set(related.map((tc) => tc.code));
      const indexCases = [...related, ...testCases.filter((tc) => !relatedCodes.has(tc.code)).slice(-Math.max(0, MAX_INDEX_CASES - related.length))].slice(0, MAX_INDEX_CASES);

      const prompt = buildCoverageRepairPrompt({
        requirement_description: input.requirement_description,
        documents: scopeDocumentsToAtoms(input.documents, batchIds),
        existing_test_cases: indexCases,
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
          label: `repair round ${round}/${maxRounds}, batch ${batchNumber}`,
          timeoutMs,
          minAttemptMs,
          maxOutputTokens: maxOutputTokensFor(estOut, { floor: 4_096, ceiling: maxOut }),
          budget: input.budget,
          telemetry: { repair_round: round, batch_size: batch.length, est_out_tokens: estOut },
          // An EMPTY array is a valid answer here ("nothing I can add for these atoms"). Rejecting it
          // (generatedTestCasesSchema requires >= 1) made the engine resample and the loop split —
          // paying twice to learn what the model already said. It counts as "no contribution".
          validate: (raw) =>
            validateAIJson(z.array(generatedTestCaseSchema), unwrapArrayResponse(raw), 'coverage repair test cases'),
        });
        modelsUsed.add(result.model);
        newCases = result.data;
        if (result.truncated) {
          issues.push({
            code: 'truncated_response',
            severity: 'warning',
            message: `Batch repair (vòng ${round}) bị cắt cụt — đã giữ phần hợp lệ; atom còn thiếu sẽ được thử lại ở batch nhỏ hơn.`,
          });
        }
      } catch (error) {
        const failure: FailureCode = error instanceof GeminiProviderError ? error.meta.failure ?? 'UNKNOWN' : 'UNKNOWN';
        // Gui lai y het khong the thanh cong, nhung gui NHO HON thi co the: chia doi roi tiep tuc.
        if (isSplittableFailure(failure) && batch.length > 3 && queued.depth < MAX_SPLIT_DEPTH) {
          const mid = Math.ceil(batch.length / 2);
          queue.unshift(
            { atoms: batch.slice(0, mid), depth: queued.depth + 1 },
            { atoms: batch.slice(mid), depth: queued.depth + 1 },
          );
          issues.push({
            code: 'batch_split',
            severity: 'warning',
            message: `Batch repair ${batch.length} atom thất bại (${failure}) — chia đôi và thử lại nhỏ hơn.`,
          });
          continue;
        }
        const message =
          error instanceof GeminiProviderError
            ? error.userMessage
            : 'Không gọi được Gemini cho vòng sửa chữa độ phủ tài liệu.';
        console.error(`[Coverage] repair round ${round} batch ${batchNumber} failed (${failure})`);
        return finish(failure === 'SERVER_BUDGET_EXHAUSTED' ? 'budget_exhausted' : 'provider_error', message);
      }

      // 1) Bo atom_id bia dat + danh lai so step.
      const normalized = normalizeGeneratedTestCases(newCases, input.documents);
      issues.push(...normalized.issues);

      // 2) CHONG AN GIAN: chi giu case vua (a) tro toi it nhat 1 atom dang thieu,
      //    VA (b) that su co bang chung ngu nghia cho atom do. Dieu kien (b) moi
      //    la then chot: khong co no, mot case rong tuech gan dung ID van duoc
      //    tinh la "dong gop" va coverage nhay len 100% ma khong ai test gi ca.
      const inventory = collectAtomInventory(input.documents);
      const contributing = normalized.test_cases.filter((testCase) => {
        const haystack = buildTestCaseHaystack(testCase);
        return (testCase.source_requirement_ids ?? []).some((id) => {
          if (!stillUncovered.has(id)) return false;
          const atom = inventory.byId.get(id);
          if (!atom) return false;
          return assessMappingEvidence(atom, testCase, haystack).has_evidence;
        });
      });

      const skipped = normalized.test_cases.length - contributing.length;
      if (skipped > 0) {
        console.warn(
          `[Coverage] repair dropped ${skipped} case(s) that covered no uncovered atom, or claimed one without actually testing it`,
        );
      }

      // 3) Merge (giu nguyen toan bo case cu, cap ma moi khong trung, khu trung tieu de).
      const merged = mergeTestCases(testCases, contributing);
      testCases = merged.test_cases;

      // 4) Tinh lai bang CODE sau moi batch — nguon su that duy nhat.
      coverage = computeDocumentCoverage(input.documents, testCases)!;

      // 5) Ghi nhan lan thu cho tung atom cua batch nay.
      const nowUncovered = new Set(coverage.uncovered.map((a) => a.atom_id));
      for (const atom of batch) {
        if (nowUncovered.has(atom.atom_id)) attempts.set(atom.atom_id, (attempts.get(atom.atom_id) ?? 0) + 1);
      }
      if (coverage.is_complete) break;
    }

    if (coverage.is_complete) break;

    if (coverage.covered_atoms <= coveredBefore) {
      console.warn(
        `[Coverage] repair round ${round} made no progress (${coverage.covered_atoms}/${coverage.total_atoms}) — dừng để tránh lặp vô hạn`,
      );
      return finishNoProgress();
    }
  }

  return finish(coverage.is_complete ? 'complete' : 'max_rounds');
}
