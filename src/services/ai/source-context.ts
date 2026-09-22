// ============================================================================
// File: src/services/ai/source-context.ts
// NGUON DU LIEU CHUNG cho Generate / Coverage Repair / Review / Enhance.
// ----------------------------------------------------------------------------
// Van de cu: moi luong tu build prompt theo cach rieng.
//   • Generate  : thay requirement + tai lieu + atom + RAG
//   • Review    : CHI thay requirement + test case  (mu hoan toan voi tai lieu)
//   • Enhance   : CHI thay requirement + test case + review (cung mu)
// Hau qua: Review cham 95% cho 1 bo test case bo sot 85/126 atom, roi Enhance
// "sua" theo nhan xet cua mot con diem sai — khong ai trong chuoi biet tai lieu
// con thieu gi.
//
// Gio ca 4 luong nhan CUNG MOT `QAAISourceContext` va CUNG MOT ham format, nen
// chung nhin thay chinh xac cung mot su that.
// ============================================================================

import type { ParsedDocument } from '@/models/validators/document';
import type {
  GeneratedTestCase,
  GenerationAnalysis,
  ReviewResult,
} from '@/models/validators/test-case';
import type { DocumentCoverageResult, UncoveredAtom } from '@/services/documents/coverage';

export type QAAISourceContext = {
  requirement_description: string;
  documents: ParsedDocument[];
  /** Tat ca atom, da gop tu `documents` (xem collectAtomInventory). */
  retrieved_old_test_cases: GeneratedTestCase[];
  generated_analysis?: GenerationAnalysis | null;
  current_test_cases?: GeneratedTestCase[];
  document_coverage?: DocumentCoverageResult | null;
  review_result?: ReviewResult | null;
};

/** Tong so atom trong context (0 neu khong dinh kem tai lieu). */
export function countAtoms(documents: ParsedDocument[] | undefined | null): number {
  let total = 0;
  const seen = new Set<string>();
  for (const doc of documents ?? []) {
    for (const atom of doc.atoms ?? []) {
      if (!atom?.atom_id || seen.has(atom.atom_id)) continue;
      seen.add(atom.atom_id);
      total++;
    }
  }
  return total;
}

/**
 * Render tai lieu + atom cho prompt. DUNG CHUNG boi generation-agent,
 * coverage-repair-agent, review-agent va enhance-agent — neu format nay doi,
 * ca 4 luong doi cung luc, khong the lech nhau nua.
 */
export function formatDocumentContextForPrompt(documents: ParsedDocument[]): string {
  if (documents.length === 0) {
    return '(No documents were attached via the AI Document Reader — proceed using only the requirement description.)';
  }

  return documents
    .map(
      (doc, idx) => `
=== DOCUMENT #${idx + 1}: ${doc.title} (source: ${doc.source_type}) ===
Summary: ${doc.summary}
Atoms (${doc.atoms.length} — each MUST be mapped in analysis.document_atom_plan AND appear in source_requirement_ids of at least one test case):
${doc.atoms
  .map(
    (a) =>
      `  [${a.atom_id}] (${a.atom_type}${a.screen_or_section ? `, ${a.screen_or_section}` : ''}) ${a.label} — ${a.detail}`,
  )
  .join('\n')}
=== END DOCUMENT #${idx + 1} ===
`,
    )
    .join('\n');
}

/** Render ket qua coverage DETERMINISTIC (do code tinh) cho prompt. */
export function formatCoverageForPrompt(coverage: DocumentCoverageResult | null | undefined): string {
  if (!coverage) {
    return '(No documents attached — document coverage does not apply to this request.)';
  }

  const header =
    `Deterministic document coverage computed by the application (NOT by you): ${coverage.covered_atoms}/${coverage.total_atoms} = ${coverage.coverage_percent}%` +
    (coverage.weak_evidence_atoms > 0
      ? `\n${coverage.weak_evidence_atoms} atom(s) are cited in source_requirement_ids but NOT actually verified by the citing test case. Citing an atom_id does not cover it.`
      : '');

  if (coverage.is_complete) {
    return `${header}\nAll document atoms are currently mapped. Do NOT remove any existing source_requirement_ids mapping.`;
  }

  const uncoveredList = coverage.uncovered
    .map(
      (atom) =>
        `  [${atom.atom_id}] (${atom.atom_type}${atom.screen_or_section ? `, ${atom.screen_or_section}` : ''}, doc: ${atom.source_document}) ${atom.label} — ${atom.detail}` +
        (atom.gap_kind === 'weak_evidence'
          ? `\n      ⚠ FALSE MAPPING: ${atom.claimed_by.join(', ')} list this atom_id but never actually test it. Write a case that verifies it, or extend one of those cases so it genuinely does.`
          : ''),
    )
    .join('\n');

  const invalidNote =
    coverage.invalid_atom_ids.length > 0
      ? `\n\nINVALID atom IDs that were hallucinated and removed (never reuse these): ${coverage.invalid_atom_ids
          .map((i) => i.atom_id)
          .join(', ')}`
      : '';

  return `${header}
UNCOVERED ATOMS (${coverage.uncovered.length}) — these are the gaps you must close:
${uncoveredList}${invalidNote}`;
}

/** Render bo test case hien tai (dung cho review/enhance/repair). */
export function formatTestCasesForPrompt(testCases: GeneratedTestCase[]): string {
  if (testCases.length === 0) return '(No test cases yet.)';
  return JSON.stringify(testCases, null, 2);
}

/**
 * Chi liet ke MA + TIEU DE + atom da cover cua case hien co. Dung trong repair
 * prompt: du de Gemini tranh viet trung kich ban va tiep tuc day ma, nhung
 * khong nhoi toan bo body cua 100+ case vao context window (thu se an het cho
 * cua danh sach atom con thieu — dung phan quan trong nhat cua request).
 */
export function formatTestCaseIndexForPrompt(testCases: GeneratedTestCase[]): string {
  if (testCases.length === 0) return '(No existing test cases.)';
  return testCases
    .map(
      (tc) =>
        `- ${tc.code} [${tc.category}] ${tc.title}${
          (tc.source_requirement_ids?.length ?? 0) > 0
            ? ` → covers: ${tc.source_requirement_ids!.join(', ')}`
            : ''
        }`,
    )
    .join('\n');
}

/** Render danh sach atom con thieu cho 1 batch repair. */
export function formatUncoveredAtomsForPrompt(atoms: UncoveredAtom[]): string {
  return atoms
    .map(
      (atom) => `- atom_id: ${atom.atom_id}
  atom_type: ${atom.atom_type}
  label: ${atom.label}
  detail: ${atom.detail}
  screen_or_section: ${atom.screen_or_section ?? '(none)'}
  source_document: ${atom.source_document}`,
    )
    .join('\n');
}

/**
 * Ket qua Review tra ve cho client. Diem QUAN TRONG: `document_coverage` va
 * `coverage_score` o day KHONG phai con so Gemini tu bao cao.
 *
 *   document_coverage        = do ung dung tinh (nguon su that)
 *   ai_reported_coverage_score = con so Gemini dua ra, giu lai de audit
 *   coverage_score           = da bi CHAN TREN boi do phu tai lieu that
 *
 * Vi sao phai chan tren: neu code do duoc 41/126 = 32.5% ma Gemini bao 95%, thi
 * 95% la mot loi khang dinh sai. Hien thi no se khien QA tin la bo test da du.
 */
export type ReviewResultWithCoverage = ReviewResult & {
  document_coverage: DocumentCoverageResult | null;
  ai_reported_coverage_score: number;
  coverage_score_capped: boolean;
};

/**
 * Ap tran do phu tai lieu len diem review cua AI. Chi ap dung khi CO tai lieu
 * dinh kem — khong co tai lieu thi khong ton tai con so deterministic de doi chieu.
 */
export function reconcileReviewCoverage(
  review: ReviewResult,
  coverage: DocumentCoverageResult | null,
): ReviewResultWithCoverage {
  const aiScore = review.coverage_score;
  if (!coverage) {
    return {
      ...review,
      document_coverage: null,
      ai_reported_coverage_score: aiScore,
      coverage_score_capped: false,
    };
  }

  const capped = Math.min(aiScore, coverage.coverage_percent);
  if (capped < aiScore) {
    console.warn(
      `[Review] AI báo coverage ${aiScore}% nhưng độ phủ tài liệu thực tế là ${coverage.coverage_percent}% (${coverage.covered_atoms}/${coverage.total_atoms}) — đã chặn trần về ${capped}%.`,
    );
  }

  return {
    ...review,
    coverage_score: capped,
    document_coverage: coverage,
    ai_reported_coverage_score: aiScore,
    coverage_score_capped: capped < aiScore,
  };
}
