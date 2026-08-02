import type { ParsedDocument } from '@/lib/validators/document';
import type { GeneratedTestCase } from '@/lib/validators/test-case';

export type DocumentCoverageResult = {
  total_atoms: number;
  covered_atoms: number;
  coverage_percent: number;
  uncovered: { atom_id: string; label: string; source_document: string }[];
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
    doc.atoms.map((atom) => ({ atom_id: atom.atom_id, label: atom.label, source_document: doc.title })),
  );
  if (allAtoms.length === 0) return null;

  const referencedIds = new Set<string>();
  for (const testCase of testCases ?? []) {
    for (const id of testCase.source_requirement_ids ?? []) referencedIds.add(id);
  }

  const uncovered = allAtoms.filter((atom) => !referencedIds.has(atom.atom_id));
  const coveredCount = allAtoms.length - uncovered.length;

  return {
    total_atoms: allAtoms.length,
    covered_atoms: coveredCount,
    coverage_percent: Math.round((coveredCount / allAtoms.length) * 1000) / 10,
    uncovered,
  };
}
