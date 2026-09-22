import type { DocumentAtom, ParsedDocument } from '@/models/validators/document';
import type { GeneratedTestCase } from '@/models/validators/test-case';
import {
  assessMappingEvidence,
  buildTestCaseHaystack,
  isSemanticEvidenceRequired,
} from './coverage-evidence';

// ============================================================================
// File: src/services/documents/coverage.ts
// NGUON SU THAT DUY NHAT ve do phu tai lieu.
// ----------------------------------------------------------------------------
// Tinh HOAN TOAN BANG CODE tu:
//      atom that su co trong document_context
//    + test case that su duoc sinh ra
//    + source_requirement_ids that su nam trong tung test case
//
// KHONG dung `analysis.document_atom_plan` cua Gemini, KHONG dung token
// similarity, KHONG dung diem so AI tu bao cao. Output cua AI chi la DE XUAT;
// ham nay la TRONG TAI. Neu Gemini noi 95% ma o day tinh ra 32.5% thi 32.5%
// moi la con so duoc hien thi, duoc luu, va duoc dung de quyet dinh
// thanh cong/that bai cua request (xem services/ai/coverage-repair.ts).
// ============================================================================

// 'weak_evidence' = atom_id CO trong source_requirement_ids, nhung khong mot
// test case nao thuc su nhac den noi dung cua atom. Day la mapping gia — xem
// coverage-evidence.ts. No KHONG duoc tinh la covered khi che do bang chung
// ngu nghia dang bat (mac dinh).
export type AtomCoverageStatus = 'covered' | 'weak_evidence' | 'uncovered';

export type TraceabilityMatrixRow = {
  atom_id: string;
  atom_type: string;
  label: string;
  screen_or_section?: string;
  source_document: string;
  /** Cac test case (code + title) co source_requirement_ids chua atom_id nay.
   * Mang rong nghia la atom CHUA duoc case nao cover. */
  covered_by: { code: string; title: string; has_evidence: boolean; evidence: string }[];
  status: AtomCoverageStatus;
};

export type UncoveredAtom = {
  atom_id: string;
  atom_type: string;
  label: string;
  detail: string;
  screen_or_section?: string;
  source_document: string;
  /** 'unmapped' = khong case nao tro toi. 'weak_evidence' = co tro toi nhung
   * khong case nao that su kiem tra atom — repair prompt can noi ro su khac biet. */
  gap_kind: 'unmapped' | 'weak_evidence';
  /** Cac case dang tuyen bo cover atom nay ma khong co bang chung. */
  claimed_by: string[];
};

/** Mot atom_id duoc test case tham chieu NHUNG khong ton tai trong tai lieu nao. */
export type InvalidAtomReference = {
  atom_id: string;
  referenced_by: string[];
};

export type DocumentCoverageResult = {
  total_atoms: number;
  covered_atoms: number;
  /** Lam tron 1 chu so thap phan, vd 32.5. Dung `is_complete` de kiem tra hoan tat. */
  coverage_percent: number;
  uncovered: UncoveredAtom[];
  /** ID do AI bia ra (hallucinated) — khong bao gio duoc tinh la covered. */
  invalid_atom_ids: InvalidAtomReference[];
  /** So atom duoc tro toi nhung khong co bang chung ngu nghia (mapping gia). */
  weak_evidence_atoms: number;
  /** true khi che do bang chung ngu nghia dang bat (COVERAGE_REQUIRE_SEMANTIC_EVIDENCE). */
  semantic_evidence_required: boolean;
  /** Dieu kien hoan tat DUY NHAT: khong con atom nao thieu bang chung. */
  is_complete: boolean;
  matrix: TraceabilityMatrixRow[];
};

export type AtomInventory = {
  /** atom_id -> ban ghi atom day du + ten tai lieu chua no. */
  byId: Map<string, DocumentAtom & { source_document: string }>;
  ordered: (DocumentAtom & { source_document: string })[];
};

/**
 * Gom toan bo atom tu moi tai lieu dinh kem. Atom trung atom_id giua 2 tai lieu
 * duoc gop lam 1 (ban ghi dau tien thang) — neu khong, mau so cua coverage se
 * phong len mot cach gia tao va khong bao gio dat 100%.
 */
export function collectAtomInventory(documents: ParsedDocument[] | undefined | null): AtomInventory {
  const byId = new Map<string, DocumentAtom & { source_document: string }>();
  const ordered: (DocumentAtom & { source_document: string })[] = [];

  for (const doc of documents ?? []) {
    for (const atom of doc.atoms ?? []) {
      if (!atom?.atom_id || byId.has(atom.atom_id)) continue;
      const record = { ...atom, source_document: doc.title };
      byId.set(atom.atom_id, record);
      ordered.push(record);
    }
  }

  return { byId, ordered };
}

/**
 * Doi chieu MOI atom voi source_requirement_ids ma AI gan cho tung test case.
 * Tra ve null neu khong co tai lieu nao dinh kem (luc do khong ton tai khai
 * niem "do phu tai lieu" va request van hop le).
 */
export function computeDocumentCoverage(
  documents: ParsedDocument[] | undefined | null,
  testCases: GeneratedTestCase[] | undefined | null,
): DocumentCoverageResult | null {
  const inventory = collectAtomInventory(documents);
  if (inventory.ordered.length === 0) return null;

  const requireEvidence = isSemanticEvidenceRequired();

  // Tinh haystack 1 LAN cho moi test case. Khong co buoc nay, moi cap
  // (atom x case) se dung lai chuoi noi dung cua case — voi 126 atom va 150
  // case do la ~19k lan chuan hoa chuoi thua.
  const haystacks = new Map<string, ReturnType<typeof buildTestCaseHaystack>>();
  for (const testCase of testCases ?? []) {
    if (!haystacks.has(testCase.code)) haystacks.set(testCase.code, buildTestCaseHaystack(testCase));
  }

  type Claim = { code: string; title: string; has_evidence: boolean; evidence: string };
  const claimsByAtomId = new Map<string, Claim[]>();
  const invalidRefs = new Map<string, Set<string>>();

  for (const testCase of testCases ?? []) {
    // Khu trung id trong CUNG 1 case: 1 case liet ke atom X ba lan van chi la
    // "1 case dang cover X" — khong duoc de no lam dep bang traceability.
    const uniqueIds = new Set(testCase.source_requirement_ids ?? []);
    for (const rawId of uniqueIds) {
      const id = typeof rawId === 'string' ? rawId.trim() : '';
      if (!id) continue;

      const atom = inventory.byId.get(id);
      if (!atom) {
        // ID bia dat: ghi nhan de bao cao, TUYET DOI khong tinh vao covered.
        const refs = invalidRefs.get(id) ?? new Set<string>();
        refs.add(testCase.code);
        invalidRefs.set(id, refs);
        continue;
      }

      // BANG CHUNG NGU NGHIA: gan ID vao mang la chua du (xem coverage-evidence.ts).
      const evidence = assessMappingEvidence(atom, testCase, haystacks.get(testCase.code));
      const list = claimsByAtomId.get(id) ?? [];
      list.push({
        code: testCase.code,
        title: testCase.title,
        has_evidence: evidence.has_evidence,
        evidence: evidence.reason,
      });
      claimsByAtomId.set(id, list);
    }
  }

  const matrix: TraceabilityMatrixRow[] = inventory.ordered.map((atom) => {
    const claims = claimsByAtomId.get(atom.atom_id) ?? [];
    const proven = claims.some((c) => c.has_evidence);

    const status: AtomCoverageStatus =
      claims.length === 0 ? 'uncovered' : proven || !requireEvidence ? 'covered' : 'weak_evidence';

    return {
      atom_id: atom.atom_id,
      atom_type: atom.atom_type,
      label: atom.label,
      screen_or_section: atom.screen_or_section,
      source_document: atom.source_document,
      covered_by: claims,
      status,
    };
  });

  const gaps = matrix.filter((row) => row.status !== 'covered');
  const uncovered: UncoveredAtom[] = gaps.map((row) => {
    const atom = inventory.byId.get(row.atom_id)!;
    return {
      atom_id: row.atom_id,
      atom_type: row.atom_type,
      label: row.label,
      detail: atom.detail,
      screen_or_section: row.screen_or_section,
      source_document: row.source_document,
      gap_kind: row.status === 'weak_evidence' ? 'weak_evidence' : 'unmapped',
      claimed_by: row.covered_by.map((c) => c.code),
    };
  });

  const total = inventory.ordered.length;
  const covered = total - uncovered.length;

  return {
    total_atoms: total,
    covered_atoms: covered,
    coverage_percent: Math.round((covered / total) * 1000) / 10,
    uncovered,
    invalid_atom_ids: [...invalidRefs.entries()].map(([atom_id, refs]) => ({
      atom_id,
      referenced_by: [...refs],
    })),
    weak_evidence_atoms: matrix.filter((row) => row.status === 'weak_evidence').length,
    semantic_evidence_required: requireEvidence,
    // So sanh SO LUONG, khong so sanh percent === 100: 1259/1260 lam tron len
    // van ra 99.9, nhung 12599/12600 co the lam tron thanh 100.0 — dung percent
    // de quyet dinh hoan tat se am tham bo sot atom o bo tai lieu lon.
    is_complete: covered === total,
    matrix,
  };
}

/**
 * Loai bo moi atom_id KHONG ton tai trong tai lieu khoi source_requirement_ids
 * (ID do AI bia ra), dong thoi khu trung. Tra ve ban sao — khong sua tai cho.
 *
 * Day la buoc BAT BUOC truoc khi tinh coverage/luu DB: neu de ID bia dat ton
 * tai, bang traceability se tro thanh mot ban ghi sai su that va cac lan
 * enhance/review sau se hoc theo no.
 */
export function stripInvalidAtomReferences(
  testCases: GeneratedTestCase[],
  documents: ParsedDocument[] | undefined | null,
): { test_cases: GeneratedTestCase[]; removed: InvalidAtomReference[] } {
  const inventory = collectAtomInventory(documents);
  if (inventory.byId.size === 0) {
    // Khong co tai lieu -> khong co "inventory hop le" de doi chieu; giu nguyen.
    return { test_cases: testCases, removed: [] };
  }

  const removed = new Map<string, Set<string>>();
  const cleaned = testCases.map((testCase) => {
    const ids = testCase.source_requirement_ids;
    if (!ids || ids.length === 0) return testCase;

    const kept: string[] = [];
    const seen = new Set<string>();
    for (const rawId of ids) {
      const id = typeof rawId === 'string' ? rawId.trim() : '';
      if (!id || seen.has(id)) continue;
      seen.add(id);
      if (inventory.byId.has(id)) {
        kept.push(id);
      } else {
        const refs = removed.get(id) ?? new Set<string>();
        refs.add(testCase.code);
        removed.set(id, refs);
      }
    }

    if (kept.length === ids.length) return testCase;
    return { ...testCase, source_requirement_ids: kept };
  });

  return {
    test_cases: cleaned,
    removed: [...removed.entries()].map(([atom_id, refs]) => ({ atom_id, referenced_by: [...refs] })),
  };
}

/**
 * Nhom atom chua duoc cover theo tai lieu + man hinh/section, roi chia thanh cac
 * batch kich thuoc toi da `batchSize`.
 *
 * Vi sao nhom theo section chu khong cat tuy tien: 1 lan goi repair nen nhan
 * cac atom THUOC CUNG 1 luong nghiep vu, de Gemini viet duoc test case theo
 * dung flow (Login -> Dashboard -> Create -> Submit) thay vi tron cac buoc roi
 * rac tu nhieu man hinh khac nhau vao cung 1 case.
 */
export function groupUncoveredAtomsIntoBatches(
  uncovered: UncoveredAtom[],
  batchSize: number,
): UncoveredAtom[][] {
  if (uncovered.length === 0) return [];
  const size = Math.max(1, batchSize);

  const groups = new Map<string, UncoveredAtom[]>();
  for (const atom of uncovered) {
    const key = `${atom.source_document}⁞${atom.screen_or_section ?? ''}`;
    const list = groups.get(key) ?? [];
    list.push(atom);
    groups.set(key, list);
  }

  const batches: UncoveredAtom[][] = [];
  let current: UncoveredAtom[] = [];

  for (const group of groups.values()) {
    for (const atom of group) {
      current.push(atom);
      if (current.length >= size) {
        batches.push(current);
        current = [];
      }
    }
    // Ket thuc 1 section: neu batch hien tai da tuong doi day thi chot lai de
    // khong tron section ke tiep vao cung 1 request.
    if (current.length >= size * 0.6) {
      batches.push(current);
      current = [];
    }
  }

  if (current.length > 0) batches.push(current);
  return batches;
}
