import type { ParsedDocument } from '@/models/validators/document';
import type { GeneratedTestCase } from '@/models/validators/test-case';

export type TraceabilityMatrixRow = {
  atom_id: string;
  atom_type: string;
  label: string;
  screen_or_section?: string;
  source_document: string;
  /** Cac test case (code + title) co source_requirement_ids chua atom_id nay.
   * Mang rong nghia la atom CHUA duoc case nao cover (giong "uncovered" cu). */
  covered_by: { code: string; title: string }[];
};

export type DocumentCoverageResult = {
  total_atoms: number;
  covered_atoms: number;
  coverage_percent: number;
  uncovered: { atom_id: string; label: string; source_document: string }[];
  /** Bang chi tiet atom ↔ test case, dung cho UI "Traceability Matrix" (xem
   * traceability-matrix.tsx) - truoc day chi tra ve SO LUONG covered/uncovered,
   * khong cho biet atom da-cover thi cu the DUOC COVER BOI CASE NAO, nen khong
   * the audit "case nay co dang lam dung 1 rule khong lien quan khong". */
  matrix: TraceabilityMatrixRow[];
};

/**
 * Doi chieu MOI atom trich xuat tu tai lieu dinh kem (man hinh Figma, rule
 * FS/logic doc, cot/entity ERD, buoc trong diagram) voi source_requirement_ids
 * ma Generation Agent gan cho tung test case.
 *
 * Day la co che thuc thi o MUC CODE cho yeu cau "mapping 100%" trong prompt
 * (lib/ai/prompts/generation-agent.ts PHASE 0.5) — prompt YEU CAU AI lam dieu
 * do, con ham nay XAC MINH no thuc su xay ra va tra ve danh sach atom bi bo sot
 * (neu co) thay vi chi tin loi AI. Tra ve null neu khong co tai lieu nao dinh kem.
 */
export function computeDocumentCoverage(
  documents: ParsedDocument[] | undefined | null,
  testCases: GeneratedTestCase[] | undefined | null,
): DocumentCoverageResult | null {
  if (!documents || documents.length === 0) return null;

  const allAtoms = documents.flatMap((doc) =>
    doc.atoms.map((atom) => ({
      atom_id: atom.atom_id,
      atom_type: atom.atom_type,
      label: atom.label,
      screen_or_section: atom.screen_or_section,
      source_document: doc.title,
    })),
  );
  if (allAtoms.length === 0) return null;

  const casesByAtomId = new Map<string, { code: string; title: string }[]>();
  for (const testCase of testCases ?? []) {
    for (const id of testCase.source_requirement_ids ?? []) {
      const list = casesByAtomId.get(id) ?? [];
      list.push({ code: testCase.code, title: testCase.title });
      casesByAtomId.set(id, list);
    }
  }

  const matrix: TraceabilityMatrixRow[] = allAtoms.map((atom) => ({
    ...atom,
    covered_by: casesByAtomId.get(atom.atom_id) ?? [],
  }));

  const uncovered = matrix
    .filter((row) => row.covered_by.length === 0)
    .map(({ atom_id, label, source_document }) => ({ atom_id, label, source_document }));
  const coveredCount = allAtoms.length - uncovered.length;

  return {
    total_atoms: allAtoms.length,
    covered_atoms: coveredCount,
    coverage_percent: Math.round((coveredCount / allAtoms.length) * 1000) / 10,
    uncovered,
    matrix,
  };
}
