import { describe, expect, it } from 'vitest';
import type { GeneratedTestCase, GenerationAnalysis } from '@/models/validators/test-case';
import type { ParsedDocument } from '@/models/validators/document';
import { acceptGeneratedBatch, categoriesToRegenerate, resolveAcceptanceMode, type AcceptanceContext } from '@/services/ai/generation-acceptance';
import { contentDuplicateKind } from '@/services/ai/review-facts';
import { SEEDED_CTX, SEEDED_DOCUMENT, buildCleanSuite } from '../helpers/seeded-fixture';

const clean = buildCleanSuite();
const ctx = (over: Partial<AcceptanceContext> = {}): AcceptanceContext => ({
  mode: 'repair', detail_level: 'standard', language: 'Tiếng Việt', documents: [SEEDED_DOCUMENT], analysis: null, existing: [], ...over,
});
const copy = <T,>(x: T) => JSON.parse(JSON.stringify(x)) as T;
const issueCodes = (r: { issues: { code: string }[] }) => r.issues.map((i) => i.code);

describe('mode resolution', () => {
  it('defaults to repair; off and enforce are explicit; garbage falls back to repair', () => {
    expect(resolveAcceptanceMode(undefined)).toBe('repair');
    expect(resolveAcceptanceMode(' ENFORCE ')).toBe('enforce');
    expect(resolveAcceptanceMode('off')).toBe('off');
    expect(resolveAcceptanceMode('strict')).toBe('repair');
  });
  it('off is a true no-op', () => {
    const bad = [{ ...clean[0], steps: clean[0].steps.slice(0, 1) }];
    const r = acceptGeneratedBatch(bad, ctx({ mode: 'off' }));
    expect(r.accepted).toEqual(bad);
    expect(r.issues).toEqual([]);
  });
  it('a clean batch passes untouched in every mode', () => {
    for (const mode of ['repair', 'enforce'] as const) {
      const r = acceptGeneratedBatch(clean, ctx({ mode }));
      expect(r.accepted).toEqual(clean);
      expect(r.rejected).toEqual([]);
      expect(r.issues).toEqual([]);
    }
  });
});

describe('Q25: duplicates across batches (content, not just title)', () => {
  it('a certain duplicate (identical content, different title) is dropped against EXISTING cases', () => {
    const twin = { ...copy(clean[8]), code: 'TC_LOGIN_099', title: 'Một tiêu đề hoàn toàn khác' };
    const r = acceptGeneratedBatch([twin], ctx({ existing: clean }));
    expect(r.accepted).toEqual([]);
    expect(issueCodes(r)).toEqual(['duplicate_scenario_dropped']);
  });
  it('...and against an earlier case of the SAME batch', () => {
    const a = { ...copy(clean[8]), code: 'TC_X_1', title: 'Bỏ trống hai field đăng nhập' };
    const b = { ...copy(clean[8]), code: 'TC_X_2', title: 'Hai field đều bị để trống khi đăng nhập' };
    expect(acceptGeneratedBatch([a, b], ctx()).accepted.map((c) => c.code)).toEqual(['TC_X_1']);
  });
  it('the 8-vs-20 boundary pair (different data) and a success/failure pair are NOT duplicates', () => {
    expect(contentDuplicateKind(clean[9], clean[10])).toBeNull();
    // (identical CONTENT under a contradictory title is still a duplicate; polarity matters when content differs)
    const ok = { ...copy(clean[0]), title: 'Đăng nhập thành công với tài khoản hợp lệ' };
    const bad = { ...copy(clean[0]), title: 'Đăng nhập không thành công với tài khoản hợp lệ', final_expected_result: 'Hệ thống từ chối đăng nhập và ở lại trang Đăng nhập' };
    expect(contentDuplicateKind(ok, bad)).toBeNull();
    expect(acceptGeneratedBatch([clean[10]], ctx({ existing: [clean[9]] })).accepted).toHaveLength(1);
  });
  it('same data + near-identical title + same polarity IS a duplicate even if one step differs', () => {
    const near = { ...copy(clean[0]), code: 'TC_N_1', title: clean[0].title + ' ', steps: copy(clean[0].steps) };
    near.steps[4].expected_result = 'Một kết quả khác một chút ở bước cuối';
    expect(contentDuplicateKind(clean[0], near)).toBe('same_data');
  });
});

describe('Q11: priority is derived from the generator risk_ranking', () => {
  const analysis = { risk_ranking: [{ scenario: clean[5].title, severity_1_10: 9, probability_1_10: 6, detectability_1_10: 5, resulting_priority: 'Critical' }] } as unknown as GenerationAnalysis;
  it('a matching scenario gets the ranked priority, with a reported reason', () => {
    const r = acceptGeneratedBatch([{ ...copy(clean[5]), priority: 'Normal' }], ctx({ analysis }));
    expect(r.accepted[0].priority).toBe('Critical');
    expect(issueCodes(r)).toEqual(['priority_derived']);
  });
  it('unrelated cases and a missing analysis are untouched', () => {
    expect(acceptGeneratedBatch([{ ...copy(clean[1]), priority: 'Normal' }], ctx({ analysis })).accepted[0].priority).toBe('Normal');
    expect(acceptGeneratedBatch([{ ...copy(clean[5]), priority: 'Normal' }], ctx()).accepted[0].priority).toBe('Normal');
  });
});

describe('Q12 / Q15: traceability and citations', () => {
  it('an empty citation list is filled ONLY from evidence-backed atoms', () => {
    const r = acceptGeneratedBatch([{ ...copy(clean[7]), source_requirement_ids: [] }], ctx());
    const ids = r.accepted[0].source_requirement_ids!;
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length).toBeLessThanOrEqual(2);
    expect(ids.every((id) => SEEDED_DOCUMENT.atoms.some((a) => a.atom_id === id))).toBe(true); // real atoms only
    expect(issueCodes(r)).toContain('traceability_filled');
  });
  it('nothing matches => left empty and reported, never invented', () => {
    const doc: ParsedDocument = { ...SEEDED_DOCUMENT, atoms: [{ atom_id: 'A_Z', atom_type: 'rule', label: 'Hạn mức zebra', detail: 'vượt hạn mức zebra thì từ chối' }] };
    const r = acceptGeneratedBatch([{ ...copy(clean[7]), source_requirement_ids: [] }], ctx({ documents: [doc] }));
    expect(r.accepted[0].source_requirement_ids).toEqual([]);
    expect(issueCodes(r)).toContain('traceability_missing');
  });
  it('a REDUNDANT false citation (atom exercised by another case) is dropped; coverage cannot fall', () => {
    const laundering = { ...copy(clean[9]), code: 'TC_NEW_1', test_data: { ...clean[9].test_data, note: 'x' }, source_requirement_ids: ['A_FIELD_PWD', 'A_RULE_LOCK'] };
    const r = acceptGeneratedBatch([laundering], ctx({ existing: clean }));
    expect(r.accepted[0].source_requirement_ids).toEqual(['A_FIELD_PWD']);
    expect(issueCodes(r)).toContain('citation_dropped');
  });
  it('a false citation of an atom NOBODY exercises is KEPT and reported (the coverage layer owns that error)', () => {
    const only = { ...copy(clean[9]), code: 'TC_NEW_2', source_requirement_ids: ['A_FIELD_PWD', 'A_RULE_LOCK'] };
    const r = acceptGeneratedBatch([only], ctx({ existing: [] }));
    expect(r.accepted[0].source_requirement_ids).toEqual(['A_FIELD_PWD', 'A_RULE_LOCK']);
    expect(issueCodes(r)).toContain('citation_not_exercised');
  });
  it('without atoms none of this applies', () => {
    const r = acceptGeneratedBatch([{ ...copy(clean[7]), source_requirement_ids: [] }], ctx({ documents: [] }));
    expect(issueCodes(r)).toEqual([]);
  });
});

describe('Q02 / Q04 / Q06 / Q07: quality gates', () => {
  const thin = () => ({ ...copy(clean[2]), steps: clean[2].steps.slice(0, 2) });
  const placeholder = () => copy(JSON.parse(JSON.stringify(clean[3]).split('Secur3!Word#3').join('abc123')) as GeneratedTestCase);
  const vague = () => { const c = copy(clean[4]); c.final_expected_result = 'Hoạt động bình thường'; return c; };

  it('repair mode: defects are REPORTED, never rejected (no work lost, no extra model call)', () => {
    const r = acceptGeneratedBatch([thin(), placeholder(), vague()], ctx({ mode: 'repair' }));
    expect(r.accepted).toHaveLength(3);
    expect(r.rejected).toEqual([]);
    expect(issueCodes(r).filter((c) => c === 'acceptance_quality_warning')).toHaveLength(3);
  });
  it('enforce mode: each is REJECTED with its rule-tagged reason', () => {
    const r = acceptGeneratedBatch([thin(), placeholder(), vague()], ctx({ mode: 'enforce' }));
    expect(r.accepted).toHaveLength(0);
    expect(r.rejected.map((x) => x.reasons.join())).toEqual([
      expect.stringContaining('Q02:too_few_steps'),
      expect.stringContaining('Q04:placeholder_value'),
      expect.stringContaining('Q07:vague_final_result'),
    ]);
  });
  it('enforce + relax (the final attempt): nothing is rejected, the failure is a warning — work is never lost', () => {
    const r = acceptGeneratedBatch([thin()], ctx({ mode: 'enforce', relax: true }));
    expect(r.accepted).toHaveLength(1);
    expect(issueCodes(r)).toEqual(['acceptance_relaxed']);
  });
  it('minor hygiene (too many steps, undeclared Luhn, unused data) is NOT a rejection reason', () => {
    const c = copy(clean[0]);
    c.test_data = { ...c.test_data, coupon: 'GIAMGIA50' }; // unused: Minor
    expect(acceptGeneratedBatch([c], ctx({ mode: 'enforce' })).rejected).toEqual([]);
  });
  it('a core-category case with no traceability is rejected in enforce; a cross-cutting one is not', () => {
    const core = { ...copy(clean[0]), source_requirement_ids: [], title: 'Một kịch bản không liên quan tới nguồn nào', steps: copy(clean[0].steps).map((s) => ({ ...s, action: s.action.replace(/Đăng nhập|Email|Mật khẩu|dashboard/gi, 'mục'), expected_result: s.expected_result.replace(/Đăng nhập|Email|Mật khẩu|dashboard/gi, 'mục') })), final_expected_result: 'Kết quả không liên quan 1 và 2' };
    const doc: ParsedDocument = { ...SEEDED_DOCUMENT, atoms: [{ atom_id: 'A_Z', atom_type: 'rule', label: 'Hạn mức zebra', detail: 'vượt hạn mức zebra thì từ chối' }] };
    expect(acceptGeneratedBatch([core], ctx({ mode: 'enforce', documents: [doc] })).rejected.map((r) => r.reasons.join())).toContain('Q12:no_traceability');
    expect(acceptGeneratedBatch([{ ...core, category: 'security' }], ctx({ mode: 'enforce', documents: [doc] })).rejected).toEqual([]);
  });
});

describe('categoriesToRegenerate: only categories that lost a case AND fell short', () => {
  const rej = (category: GeneratedTestCase['category']) => ({ test_case_code: 'X', category, reasons: ['Q02:too_few_steps'] });
  it('is empty without rejections, and when the batch still met the minimum', () => {
    expect(categoriesToRegenerate(['positive'], clean.slice(0, 4), [], 4)).toEqual([]);
    expect(categoriesToRegenerate(['positive'], clean.slice(0, 4), [rej('positive')], 4)).toEqual([]);
  });
  it('re-queues just the short category', () => {
    expect(categoriesToRegenerate(['positive', 'negative'], clean.slice(0, 4), [rej('negative')], 4)).toEqual(['negative']);
    expect(categoriesToRegenerate(['positive', 'negative'], clean.slice(0, 3), [rej('positive')], 4)).toEqual(['positive']);
  });
});

describe('it shares Review\'s definitions (no second copy to drift)', () => {
  it('a case Review would flag Major for Q02 is exactly what enforce rejects', async () => {
    const { runL0 } = await import('@/services/ai/review-pipeline');
    const suite = [...clean.slice(0, 2), { ...copy(clean[2]), steps: clean[2].steps.slice(0, 2) }, ...clean.slice(3)];
    const reviewFlags = runL0(suite, SEEDED_CTX).findings.some((f) => f.rule === 'Q02' && f.test_case_codes.includes('TC_LOGIN_003'));
    const rejected = acceptGeneratedBatch(suite, ctx({ mode: 'enforce' })).rejected.map((r) => r.test_case_code);
    expect(reviewFlags).toBe(true);
    expect(rejected).toContain('TC_LOGIN_003');
  });
});

describe('orchestrator control flow, simulated with the real pure functions', () => {
  // Mirrors the glue in generation-orchestrator.ts: accept -> mergeTestCases -> categoriesToRegenerate -> ONE relaxed retry.
  it('enforce: a short category is regenerated once; the retry is relaxed so the work is never lost', async () => {
    const { mergeTestCases } = await import('@/services/ai/test-case-validation');
    const four = (cat: GeneratedTestCase['category']) => clean.filter((c) => c.category === cat).slice(0, 4);
    const thinOne = { ...copy(four('negative')[0]), steps: four('negative')[0].steps.slice(0, 2) };
    const attempt1 = [...four('positive'), thinOne, ...four('negative').slice(1)];

    const first = acceptGeneratedBatch(attempt1, ctx({ mode: 'enforce' }));
    const merged1 = mergeTestCases([], first.accepted);
    const regenerate = categoriesToRegenerate(['positive', 'negative'], merged1.added, first.rejected, 4);
    expect(first.rejected.map((r) => r.test_case_code)).toEqual([thinOne.code]);
    expect(regenerate).toEqual(['negative']); // only the category that fell short

    // the model repeats the same bad case on the retry: relax => accepted with a warning, no third attempt
    const retry = acceptGeneratedBatch([{ ...thinOne, code: 'TC_RETRY_1' }], ctx({ mode: 'enforce', relax: true, existing: merged1.test_cases }));
    expect(retry.rejected).toEqual([]);
    expect(categoriesToRegenerate(['negative'], retry.accepted, retry.rejected, 4)).toEqual([]);
    expect(mergeTestCases(merged1.test_cases, retry.accepted).test_cases).toHaveLength(merged1.test_cases.length + 1);
  });
  it('repair never asks for a regeneration (no extra model call, no route-budget spend)', () => {
    const thin = { ...copy(clean[2]), steps: clean[2].steps.slice(0, 2) };
    const r = acceptGeneratedBatch([thin], ctx({ mode: 'repair' }));
    expect(categoriesToRegenerate(['positive'], r.accepted, r.rejected, 4)).toEqual([]);
  });
});
