/**
 * SEEDED-DEFECT EVALUATION HARNESS — the regression gate for any Review/Enhance change.
 *
 *   clean suite (asserted clean) -> inject known defects by mutation
 *   -> Review: RECALL (every seeded defect gets a finding with the right rule + code)
 *              PRECISION (untouched good cases get none)
 *   -> Enhance: REPAIR RATE, untouched fields identical, atom coverage not reduced
 *
 * Model calls are RECORDED responses (deterministic, CI-safe). The recorded Review output holds
 * what an ideal reviewer would say about the two SEMANTIC defects (Q08, Q13); what this proves is
 * that the application keeps/verifies/uses correct findings and rejects wrong ones. It does not
 * measure model skill. A live run would swap `callModel` (Enhance) and the Review model call.
 */
import { describe, expect, it } from 'vitest';
import type { GeneratedTestCase, GenerationAnalysis } from '@/models/validators/test-case';
import { analyzeTestCases } from '@/services/ai/review-analysis';
import { computeDocumentCoverage } from '@/services/documents/coverage';
import { finalizeReviewV2, prepareReview, runL0 } from '@/services/ai/review-pipeline';
import { runEnhanceWork, type CallModel } from '@/services/ai/enhance-orchestrator';
import type { EnhanceWorkOutput } from '@/services/ai/enhance-work';
import { SEEDED_CTX, buildCleanSuite } from '../helpers/seeded-fixture';

const RISK = {
  risk_ranking: [
    { scenario: 'Sai mật khẩu lần thứ 5 liên tục thì khóa tài khoản 15 phút', severity_1_10: 9, probability_1_10: 6, detectability_1_10: 5, resulting_priority: 'Critical' },
  ],
} as unknown as GenerationAnalysis;
const CTX = { ...SEEDED_CTX, generation_analysis: RISK };

const clean = buildCleanSuite();
const cleanBy = new Map(clean.map((c) => [c.code, c]));
const copy = (s: GeneratedTestCase[]) => JSON.parse(JSON.stringify(s)) as GeneratedTestCase[];
const get = (s: GeneratedTestCase[], code: string) => s.find((c) => c.code === code)!;

type Mutation = { id: string; touched: string[]; mutate: (s: GeneratedTestCase[]) => GeneratedTestCase[] };

const MUTATIONS: Mutation[] = [
  {
    id: 'Q02', touched: ['TC_LOGIN_003'],
    mutate: (s) => {
      const c = get(s, 'TC_LOGIN_003');
      const [open, email, pwd, ...rest] = c.steps;
      c.steps = [open, { step_number: 2, action: `${email.action} và nhập 'An0ther!Pass#2' vào field 'Mật khẩu'`, expected_result: `${email.expected_result} và ${pwd.expected_result}` }, ...rest].map((x, i) => ({ ...x, step_number: i + 1 }));
      return s;
    },
  },
  {
    id: 'Q04', touched: ['TC_LOGIN_004'],
    mutate: (s) => s.map((c) => (c.code === 'TC_LOGIN_004' ? (JSON.parse(JSON.stringify(c).split('Secur3!Word#3').join('abc123')) as GeneratedTestCase) : c)),
  },
  { id: 'Q11', touched: ['TC_LOGIN_006'], mutate: (s) => { get(s, 'TC_LOGIN_006').priority = 'Normal'; return s; } },
  { id: 'Q15', touched: ['TC_LOGIN_010'], mutate: (s) => { get(s, 'TC_LOGIN_010').source_requirement_ids!.push('A_RULE_LOCK'); return s; } },
  {
    id: 'Q25', touched: ['TC_LOGIN_014'],
    mutate: (s) => [...s, { ...JSON.parse(JSON.stringify(get(s, 'TC_LOGIN_009'))), code: 'TC_LOGIN_014', title: 'Không gửi yêu cầu khi cả hai field đều bị bỏ trống' }],
  },
  { id: 'Q26', touched: [], mutate: (s) => s.filter((c) => c.code !== 'TC_LOGIN_008') }, // delete the "only active" negative (Q10)
  { id: 'Q08', touched: ['TC_LOGIN_005'], mutate: (s) => { get(s, 'TC_LOGIN_005').category = 'positive'; return s; } },
  {
    id: 'Q13', touched: ['TC_LOGIN_007'],
    mutate: (s) => { get(s, 'TC_LOGIN_007').final_expected_result = "Hiển thị thông báo 'Tài khoản không tồn tại' và không có session token"; return s; },
  },
];
const applyAll = (ids?: string[]) => MUTATIONS.filter((m) => !ids || ids.includes(m.id)).reduce((s, m) => m.mutate(s), copy(clean));

// What an ideal reviewer says about the two defects code cannot see.
const RECORDED_SEMANTIC = [
  { rule: 'Q08', kind: 'defect', severity: 'Major', confidence: 'High', action: 'RECLASSIFY', scope: 'case', test_case_codes: ['TC_LOGIN_005'], fields_affected: ['category'], issue: 'Case asserts a rejection but is labelled positive', evidence: "TC_LOGIN_005 step 4 expects HTTP 401 and stays on 'Đăng nhập'", enhance_instruction: 'Set category to negative: the case asserts a rejection.' },
  { rule: 'Q13', kind: 'defect', severity: 'Critical', confidence: 'High', action: 'FIX', scope: 'case', test_case_codes: ['TC_LOGIN_007'], fields_affected: ['final_expected_result'], issue: 'Expected message is invented and contradicts the source', evidence: "source: 'Email hoặc mật khẩu không đúng'; TC_LOGIN_007 final says 'Tài khoản không tồn tại'", enhance_instruction: "Use the message from the source: 'Email hoặc mật khẩu không đúng'." },
] as const;

function review(suite: GeneratedTestCase[], findings: readonly unknown[] = []) {
  const analysis = analyzeTestCases({ test_cases: suite, detail_level: 'standard', language: CTX.language, required_categories: CTX.required_categories, per_category_min: CTX.per_category_min, documents: CTX.documents });
  const coverage = computeDocumentCoverage(CTX.documents, suite);
  const prepared = prepareReview({ ...CTX, test_cases: suite, analysis, coverage });
  const result = finalizeReviewV2({
    model_output: { language_detail: [], taxonomy: [], issues: [], recommendations: [], strengths: [], open_questions: [], findings: findings as never },
    analysis, test_cases: suite, prepared, required_categories: CTX.required_categories, coverage, prompt_version: 'test',
  });
  return { result, prepared, analysis, coverage };
}

describe('harness baseline', () => {
  it('the clean suite is clean: the deterministic layer finds nothing', () => {
    const l0 = runL0(clean, CTX);
    expect(l0.findings).toHaveLength(0);
    expect(l0.coverage?.coverage_percent).toBe(100);
    expect(l0.prepared.mode).toBe('source-verified');
  });
});

describe('Review RECALL: every mechanical seeded defect is found with the right rule and code', () => {
  const expectations: { id: string; rule: string; action?: string; code?: string; ref?: string }[] = [
    { id: 'Q02', rule: 'Q02', action: 'FIX', code: 'TC_LOGIN_003' },
    { id: 'Q04', rule: 'Q04', action: 'FIX', code: 'TC_LOGIN_004' },
    { id: 'Q11', rule: 'Q11', action: 'RECLASSIFY', code: 'TC_LOGIN_006' },
    { id: 'Q15', rule: 'Q15', action: 'FIX', code: 'TC_LOGIN_010' },
    { id: 'Q25', rule: 'Q25', action: 'REMOVE', code: 'TC_LOGIN_014' },
    { id: 'Q26', rule: 'Q26', action: 'ADD', ref: 'A_RULE_ACTIVE' },
  ];
  for (const e of expectations) {
    it(`${e.id}: found in isolation, and nothing is flagged on other cases`, () => {
      const m = MUTATIONS.find((x) => x.id === e.id)!;
      const suite = m.mutate(copy(clean));
      const { findings } = runL0(suite, CTX);
      const hit = findings.find((f) => f.rule === e.rule && (!e.action || f.action === e.action) && (!e.code || f.test_case_codes.includes(e.code)) && (!e.ref || f.gap_spec?.source_ref === e.ref));
      expect(hit, `${e.id} not found; got ${findings.map((f) => `${f.rule}:${f.test_case_codes}`).join(' | ')}`).toBeDefined();
      const flaggedCases = new Set(findings.filter((f) => f.scope === 'case').flatMap((f) => f.test_case_codes));
      for (const code of flaggedCases) expect(m.touched.concat(e.code ?? []), `unexpected finding on ${code}`).toContain(code);
    });
  }

  it('a seeded Q25 duplicate names a survivor and the 8-vs-20 boundary pair is NOT removed', () => {
    const { findings, prepared } = runL0(applyAll(['Q25']), CTX);
    const rem = findings.find((f) => f.rule === 'Q25' && f.action === 'REMOVE')!;
    expect(rem.survivor_code).toBe('TC_LOGIN_009');
    // The boundary pair differs by a behaviour-changing variable (8 vs 20 characters): a candidate for the model, never a removal.
    expect(prepared.facts.duplicate_pairs.some((p) => [p.a, p.b].sort().join() === 'TC_LOGIN_010,TC_LOGIN_011')).toBe(true);
    expect(findings.some((f) => f.action === 'REMOVE' && f.test_case_codes.some((c) => c === 'TC_LOGIN_010' || c === 'TC_LOGIN_011'))).toBe(false);
  });
});

describe('Review RECALL + PRECISION on the combined suite (all 8 defects injected)', () => {
  const suite = applyAll();
  const { result } = review(suite, RECORDED_SEMANTIC);

  it('recall: all 8 seeded defects have a finding with the right rule', () => {
    const rules = (code: string) => result.findings!.filter((f) => f.test_case_codes.includes(code)).map((f) => f.rule);
    expect(rules('TC_LOGIN_003')).toContain('Q02');
    expect(rules('TC_LOGIN_004')).toContain('Q04');
    expect(rules('TC_LOGIN_006')).toContain('Q11');
    expect(rules('TC_LOGIN_010')).toContain('Q15');
    expect(rules('TC_LOGIN_014')).toContain('Q25');
    expect(rules('TC_LOGIN_005')).toContain('Q08');
    expect(rules('TC_LOGIN_007')).toContain('Q13');
    expect(result.findings!.some((f) => f.rule === 'Q26' && f.gap_spec?.source_ref === 'A_RULE_ACTIVE')).toBe(true);
  });

  it('precision: cases nobody touched carry zero case-scope findings (tolerance 0)', () => {
    const untouched = ['TC_LOGIN_001', 'TC_LOGIN_002', 'TC_LOGIN_009', 'TC_LOGIN_011', 'TC_LOGIN_012', 'TC_LOGIN_013'];
    for (const f of result.findings!.filter((x) => x.scope === 'case')) {
      for (const code of f.test_case_codes) expect(untouched, `${f.rule} on untouched ${code}`).not.toContain(code);
    }
  });

  it('every finding has an application id and fingerprint; the score is computed with its arithmetic', () => {
    expect(result.findings!.every((f) => /^F-\d{3}$/.test(f.finding_id) && f.fingerprint.length === 16)).toBe(true);
    expect(result.score!.score).toBeLessThan(100);
    expect(result.score!.arithmetic.length).toBeGreaterThan(0);
    expect(result.review_mode).toBe('source-verified');
  });

  it('the Q13 finding stays High because its evidence quotes the source verbatim', () => {
    expect(result.findings!.find((f) => f.rule === 'Q13')!.confidence).toBe('High');
  });
});

// ── Enhance with recorded responses ─────────────────────────────────────────

/** An "ideal" Enhance model: restores each defective field from the clean suite. */
function idealModel(log: string[] = []): CallModel {
  return async ({ batch }) => {
    const out: EnhanceWorkOutput = { patches: [], new_cases: [], resolutions: [], changes: [] };
    for (const { order, codes } of batch) {
      log.push(order.rule);
      const patchFor = (code: string): Record<string, unknown> | null => {
        const c = cleanBy.get(code)!;
        switch (order.rule) {
          case 'Q02': return { steps: c.steps };
          case 'Q04': return { test_data_entries: Object.entries(c.test_data).map(([field, value]) => ({ field, value })), steps: c.steps };
          case 'Q11': return { priority: c.priority };
          case 'Q15': return { source_requirement_ids: c.source_requirement_ids };
          case 'Q08': return { category: c.category };
          case 'Q13': return { final_expected_result: c.final_expected_result };
          default: return null;
        }
      };
      if (order.rule === 'Q26') {
        out.new_cases.push({ finding_id: order.finding_id, test_case: { ...cleanBy.get('TC_LOGIN_008')!, code: 'TC_LOGIN_099' } });
        out.resolutions.push({ finding_id: order.finding_id, status: 'ADDED', test_case_codes: [], note: '' });
        continue;
      }
      for (const code of codes) {
        const set = patchFor(code);
        if (set) out.patches.push({ code, set: set as never });
      }
      out.resolutions.push({ finding_id: order.finding_id, status: 'FIXED', test_case_codes: codes, note: '' });
    }
    return { data: out, model: 'recorded', truncated: false };
  };
}

const RECORDED_CLIENT_FINDINGS = () => review(applyAll(), RECORDED_SEMANTIC).result.findings!;

describe('Enhance REPAIR RATE on the combined suite', () => {
  const broken = applyAll();
  const calls: string[] = [];
  const run = () =>
    runEnhanceWork({
      cases: broken,
      client_findings: RECORDED_CLIENT_FINDINGS(),
      strengths: [],
      open_questions: [],
      l0: CTX,
      budget_tokens: 4_000,
      callModel: idealModel(calls),
    });

  it('resolves every seeded defect (FIXED / ADDED / REMOVED) and leaves nothing unresolved', async () => {
    const r = await run();
    const status = (rule: string) => r.resolutions.filter((x) => x.rule === rule).map((x) => x.status);
    for (const rule of ['Q02', 'Q04', 'Q11', 'Q15', 'Q08', 'Q13']) expect(status(rule)).toEqual(['FIXED']);
    expect(status('Q26')).toEqual(['ADDED']);
    expect(status('Q25')).toEqual(['REMOVED']);
    expect(r.unresolved).toHaveLength(0);
    expect(r.removed_codes).toEqual(['TC_LOGIN_014']);
  });

  it('mechanical flags drop to zero and the delta is reported', async () => {
    const r = await run();
    expect(r.delta.mechanical_before.total).toBeGreaterThanOrEqual(6);
    expect(r.delta.mechanical_after.total).toBe(0);
    expect(r.delta.mechanical_resolved).toBeGreaterThanOrEqual(6);
    expect(r.delta.mechanical_introduced).toBe(0);
    expect(r.delta.cases_flagged_after).toBe(0);
    expect(r.delta.score_after).toBeGreaterThan(r.delta.score_before);
    expect(r.delta.score_is_estimate).toBe(true);
  });

  it('no regression in atom coverage (it improves: the deleted "only active" negative is back)', async () => {
    const r = await run();
    expect(r.delta.atom_coverage_after!).toBeGreaterThanOrEqual(r.delta.atom_coverage_before!);
    expect(r.delta.atom_coverage_after).toBe(100);
  });

  it('untouched cases are byte-identical; patched cases differ ONLY in fields a finding named', async () => {
    const r = await run();
    const after = new Map(r.test_cases.map((c) => [c.code, c]));
    const before = new Map(broken.map((c) => [c.code, c]));
    for (const code of ['TC_LOGIN_001', 'TC_LOGIN_002', 'TC_LOGIN_009', 'TC_LOGIN_011', 'TC_LOGIN_012', 'TC_LOGIN_013']) {
      expect(after.get(code)).toEqual(before.get(code));
    }
    const allowed: Record<string, string[]> = {
      TC_LOGIN_003: ['steps'], TC_LOGIN_004: ['test_data', 'steps'], TC_LOGIN_005: ['category'], TC_LOGIN_006: ['priority'],
      TC_LOGIN_007: ['final_expected_result'], TC_LOGIN_010: ['source_requirement_ids'],
    };
    for (const [code, fields] of Object.entries(allowed)) {
      const a = after.get(code)! as unknown as Record<string, unknown>;
      const b = before.get(code)! as unknown as Record<string, unknown>;
      for (const k of Object.keys(b)) if (!fields.includes(k)) expect(a[k], `${code}.${k} changed`).toEqual(b[k]);
    }
  });

  it('new case code is allocated by the application and cites the ADD source atom', async () => {
    const r = await run();
    expect(r.added_codes).toHaveLength(1);
    expect(broken.some((c) => c.code === r.added_codes[0])).toBe(false);
    expect(r.test_cases.find((c) => c.code === r.added_codes[0])!.source_requirement_ids).toContain('A_RULE_ACTIVE');
  });

  it('the boundary pair that differs by a behaviour-changing variable survives', async () => {
    const r = await run();
    const codes = r.test_cases.map((c) => c.code);
    expect(codes).toContain('TC_LOGIN_010');
    expect(codes).toContain('TC_LOGIN_011');
  });

  it('stays within the call budget', async () => {
    const r = await run();
    expect(r.calls).toBeLessThanOrEqual(3);
  });
});
