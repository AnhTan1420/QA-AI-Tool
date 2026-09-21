/**
 * Unit tests cho services/documents/coverage.ts — nguon su that ve do phu tai lieu.
 */
import { describe, it, expect } from 'vitest';
import {
  computeDocumentCoverage,
  collectAtomInventory,
  stripInvalidAtomReferences,
  groupUncoveredAtomsIntoBatches,
} from '@/services/documents/coverage';
import type { ParsedDocument } from '@/models/validators/document';
import type { GeneratedTestCase } from '@/models/validators/test-case';

function makeDocument(atomCount: number, prefix = 'FS'): ParsedDocument {
  return {
    id: 'doc-1',
    source_type: 'document',
    title: 'Functional Specification',
    summary: 'FS cho module thanh toan',
    atoms: Array.from({ length: atomCount }, (_, i) => ({
      atom_id: `${prefix}-${i + 1}`,
      atom_type: 'rule' as const,
      label: `Rule ${i + 1}`,
      detail: `Chi tiet rule ${i + 1}`,
      screen_or_section: `Section ${Math.floor(i / 10) + 1}`,
    })),
  };
}

function makeCase(code: string, atomIds: string[]): GeneratedTestCase {
  return {
    code,
    title: `Test ${code}`,
    category: 'positive',
    priority: 'Normal',
    preconditions: [],
    test_data: {},
    steps: [{ step_number: 1, action: 'Mở màn hình', expected_result: 'Màn hình hiển thị' }],
    final_expected_result: 'Hệ thống ở trạng thái mong đợi',
    source_requirement_ids: atomIds,
  };
}

/** 1 test case cover dung 1 atom — dung de dung cac kich ban do phu. */
function casesCovering(atomIds: string[]): GeneratedTestCase[] {
  return atomIds.map((id, i) => makeCase(`TC_DOC_${String(i + 1).padStart(3, '0')}`, [id]));
}

describe('computeDocumentCoverage', () => {
  it('126/126 = 100% va is_complete = true', () => {
    const doc = makeDocument(126);
    const cases = casesCovering(doc.atoms.map((a) => a.atom_id));

    const coverage = computeDocumentCoverage([doc], cases)!;

    expect(coverage.total_atoms).toBe(126);
    expect(coverage.covered_atoms).toBe(126);
    expect(coverage.coverage_percent).toBe(100);
    expect(coverage.is_complete).toBe(true);
    expect(coverage.uncovered).toHaveLength(0);
  });

  it('41/126 = 32.5% va is_complete = false (dung kich ban loi thuc te)', () => {
    const doc = makeDocument(126);
    const cases = casesCovering(doc.atoms.slice(0, 41).map((a) => a.atom_id));

    const coverage = computeDocumentCoverage([doc], cases)!;

    expect(coverage.covered_atoms).toBe(41);
    expect(coverage.total_atoms).toBe(126);
    expect(coverage.coverage_percent).toBe(32.5);
    expect(coverage.is_complete).toBe(false);
    expect(coverage.uncovered).toHaveLength(85);
  });

  it('0/126 = 0%', () => {
    const doc = makeDocument(126);
    const coverage = computeDocumentCoverage([doc], [makeCase('TC_001', [])])!;

    expect(coverage.covered_atoms).toBe(0);
    expect(coverage.coverage_percent).toBe(0);
    expect(coverage.is_complete).toBe(false);
  });

  it('KHONG tinh atom_id bia dat la da cover', () => {
    const doc = makeDocument(3);
    const cases = [makeCase('TC_001', ['FS-1', 'FS-DOES-NOT-EXIST', 'INVENTED_ID'])];

    const coverage = computeDocumentCoverage([doc], cases)!;

    expect(coverage.covered_atoms).toBe(1);
    expect(coverage.is_complete).toBe(false);
    expect(coverage.invalid_atom_ids.map((i) => i.atom_id).sort()).toEqual([
      'FS-DOES-NOT-EXIST',
      'INVENTED_ID',
    ]);
    expect(coverage.invalid_atom_ids[0].referenced_by).toContain('TC_001');
  });

  it('atom_id trung lap trong CUNG 1 case chi tinh 1 lan', () => {
    const doc = makeDocument(2);
    const cases = [makeCase('TC_001', ['FS-1', 'FS-1', 'FS-1'])];

    const coverage = computeDocumentCoverage([doc], cases)!;

    expect(coverage.covered_atoms).toBe(1);
    const row = coverage.matrix.find((r) => r.atom_id === 'FS-1')!;
    expect(row.covered_by).toHaveLength(1);
  });

  it('nhieu case cung cover 1 atom -> matrix liet ke ca hai', () => {
    const doc = makeDocument(2);
    const cases = [makeCase('TC_001', ['FS-1']), makeCase('TC_002', ['FS-1'])];

    const coverage = computeDocumentCoverage([doc], cases)!;
    const row = coverage.matrix.find((r) => r.atom_id === 'FS-1')!;

    expect(row.covered_by.map((c) => c.code)).toEqual(['TC_001', 'TC_002']);
    expect(row.status).toBe('covered');
    expect(coverage.covered_atoms).toBe(1);
  });

  it('1 case cover nhieu atom hop le', () => {
    const doc = makeDocument(3);
    const cases = [makeCase('TC_001', ['FS-1', 'FS-2', 'FS-3'])];

    const coverage = computeDocumentCoverage([doc], cases)!;

    expect(coverage.covered_atoms).toBe(3);
    expect(coverage.is_complete).toBe(true);
  });

  it('tra ve null khi khong co tai lieu', () => {
    expect(computeDocumentCoverage([], [makeCase('TC_001', [])])).toBeNull();
    expect(computeDocumentCoverage(null, [])).toBeNull();
  });

  it('tra ve null khi tai lieu khong co atom nao', () => {
    const emptyDoc = { ...makeDocument(1), atoms: [] } as unknown as ParsedDocument;
    expect(computeDocumentCoverage([emptyDoc], [])).toBeNull();
  });

  it('gop atom trung id giua 2 tai lieu (khong thoi phong mau so)', () => {
    const docA = makeDocument(3);
    const docB = { ...makeDocument(3), id: 'doc-2', title: 'FS v2' };

    const coverage = computeDocumentCoverage([docA, docB], casesCovering(['FS-1', 'FS-2', 'FS-3']))!;

    expect(coverage.total_atoms).toBe(3);
    expect(coverage.is_complete).toBe(true);
  });

  it('is_complete dua tren SO LUONG chu khong phai percent lam tron', () => {
    // 12599/12600 lam tron 1 chu so thap phan se ra 100.0 — nhung van con 1 atom trong.
    const doc = makeDocument(12600);
    const cases = casesCovering(doc.atoms.slice(0, 12599).map((a) => a.atom_id));

    const coverage = computeDocumentCoverage([doc], cases)!;

    expect(coverage.coverage_percent).toBe(100);
    expect(coverage.is_complete).toBe(false); // <- diem mau chot
    expect(coverage.uncovered).toHaveLength(1);
  });

  it('matrix giu day du truong de audit', () => {
    const doc = makeDocument(1);
    const coverage = computeDocumentCoverage([doc], [makeCase('TC_001', ['FS-1'])])!;
    const row = coverage.matrix[0];

    expect(row).toMatchObject({
      atom_id: 'FS-1',
      atom_type: 'rule',
      label: 'Rule 1',
      screen_or_section: 'Section 1',
      source_document: 'Functional Specification',
      status: 'covered',
    });
  });
});

describe('stripInvalidAtomReferences', () => {
  it('loai bo ID bia dat va khu trung, giu nguyen ID hop le', () => {
    const doc = makeDocument(2);
    const result = stripInvalidAtomReferences(
      [makeCase('TC_001', ['FS-1', 'FS-1', 'HALLUCINATED'])],
      [doc],
    );

    expect(result.test_cases[0].source_requirement_ids).toEqual(['FS-1']);
    expect(result.removed.map((r) => r.atom_id)).toEqual(['HALLUCINATED']);
  });

  it('khong doi gi khi khong co tai lieu', () => {
    const cases = [makeCase('TC_001', ['ANYTHING'])];
    const result = stripInvalidAtomReferences(cases, []);
    expect(result.test_cases).toBe(cases);
    expect(result.removed).toHaveLength(0);
  });
});

describe('collectAtomInventory', () => {
  it('lap chi muc theo atom_id kem ten tai lieu nguon', () => {
    const inventory = collectAtomInventory([makeDocument(2)]);
    expect(inventory.ordered).toHaveLength(2);
    expect(inventory.byId.get('FS-1')?.source_document).toBe('Functional Specification');
  });
});

describe('groupUncoveredAtomsIntoBatches', () => {
  it('chia atom chua cover thanh batch khong vuot kich thuoc', () => {
    const doc = makeDocument(85);
    const coverage = computeDocumentCoverage([doc], [makeCase('TC_001', [])])!;

    const batches = groupUncoveredAtomsIntoBatches(coverage.uncovered, 35);

    expect(batches.length).toBeGreaterThan(1);
    expect(Math.max(...batches.map((b) => b.length))).toBeLessThanOrEqual(35);
    // Khong mat atom nao khi chia batch.
    expect(batches.flat()).toHaveLength(85);
  });

  it('tra ve mang rong khi khong con atom nao thieu', () => {
    expect(groupUncoveredAtomsIntoBatches([], 35)).toEqual([]);
  });
});
