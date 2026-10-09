import { describe, expect, it } from 'vitest';
import type { GeneratedTestCase } from '@/models/validators/test-case';
import { ENHANCE_LIMITS, getDetailLevelRules } from '@/services/ai/quality-standards';
import { runL0 } from '@/services/ai/review-pipeline';
import { assignIds, type RawFinding } from '@/services/ai/review-findings';
import {
  allowedFieldsByCode, planBatches, selectWorkOrders, splitByExecutor,
  type EnhanceWorkOutput, type WorkOrder,
} from '@/services/ai/enhance-work';
import { applyPatchSet, applyWorkOutputs, emptyOutcome, executeRemovals } from '@/services/ai/enhance-verify';
import { runEnhanceWork, type CallModel } from '@/services/ai/enhance-orchestrator';
import { SEEDED_CTX, buildCleanSuite } from '../helpers/seeded-fixture';

const raw = (over: Partial<RawFinding> = {}): RawFinding => ({
  rule: 'Q02', kind: 'defect', severity: 'Major', confidence: 'High', action: 'FIX', scope: 'case',
  test_case_codes: ['TC_LOGIN_003'], fields_affected: ['steps'], issue: 'Fewer than 5 steps', evidence: 'TC_LOGIN_003: 2 steps',
  enhance_instruction: 'Split merged actions.', ...over,
});
const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima', 'mike', 'november'];
// Distinct words, not digits: the fingerprint ignores 1-character tokens, so "#1" and "#2" would collapse into one finding.
const orders = (...r: RawFinding[]): WorkOrder[] =>
  assignIds(r.map((finding, i) => ({ finding: { ...finding, issue: `${finding.issue} ${WORDS[i % WORDS.length]}` }, origin: 'mechanical' as const })));
const empty = (): EnhanceWorkOutput => ({ patches: [], new_cases: [], resolutions: [], changes: [] });
const clean = buildCleanSuite();

describe('selection policy', () => {
  const all = orders(
    raw({ severity: 'Critical' }), raw({ severity: 'Major' }), raw({ severity: 'Minor' }),
    raw({ confidence: 'Low' }), raw({ kind: 'question' }), raw({ action: 'MERGE', survivor_code: 'TC_LOGIN_001' }),
  );
  it('defaults: Critical and Major of High/Medium confidence; everything else is advisory with a reason', () => {
    const { actionable, advisory } = selectWorkOrders(all);
    expect(actionable.map((o) => o.severity).sort()).toEqual(['Critical', 'Major']);
    const reasons = advisory.map((a) => a.reason).join('|');
    for (const r of ['below the Major severity floor', 'low confidence', 'question', 'MERGE is advisory']) expect(reasons).toContain(r);
    expect(advisory).toHaveLength(4);
  });
  it('the user can pick findings by fingerprint (overrides defaults) but a question or MERGE is never applied', () => {
    const picked = all.filter((o) => o.severity === 'Minor' || o.kind === 'question' || o.action === 'MERGE').map((o) => o.fingerprint);
    const { actionable } = selectWorkOrders(all, { selected_fingerprints: picked });
    expect(actionable).toHaveLength(1);
    expect(actionable[0].severity).toBe('Minor');
  });
  it('REMOVE is executed by the application, the rest by the model; most severe first', () => {
    const o = orders(raw({ severity: 'Major' }), raw({ action: 'REMOVE', survivor_code: 'TC_LOGIN_001', fields_affected: [] }), raw({ severity: 'Critical' }));
    const { actionable } = selectWorkOrders(o);
    expect(actionable[0].severity).toBe('Critical');
    const { model, removals } = splitByExecutor(actionable);
    expect([model.length, removals.length]).toEqual([2, 1]);
  });
  it('category/priority travel only with RECLASSIFY', () => {
    const o = orders(raw({ fields_affected: ['steps', 'priority'] }), raw({ action: 'RECLASSIFY', rule: 'Q11', test_case_codes: ['TC_LOGIN_004'], fields_affected: ['priority'] }));
    const f = allowedFieldsByCode(o);
    expect([...f.get('TC_LOGIN_003')!]).toEqual(['steps']);
    expect([...f.get('TC_LOGIN_004')!]).toEqual(['priority']);
  });
});

describe('budget planner (24/9 protection)', () => {
  const many = Array.from({ length: 14 }, (_, i) => ({ ...clean[i % clean.length], code: `TC_M_${String(i).padStart(3, '0')}` }));
  const flagged = (n: number, level = 'standard') => ({
    orders: orders(raw({ test_case_codes: many.slice(0, n).map((c) => c.code), severity: 'Critical' })),
    cases: many, detail_level: level,
  });

  it('every batch fits the budget; whatever does not fit is DEFERRED, never squeezed in', () => {
    const budget = 1_500;
    const plan = planBatches({ ...flagged(14), budget_tokens: budget, max_calls: 2 });
    expect(plan.batches.length).toBeGreaterThanOrEqual(1);
    expect(plan.batches.length).toBeLessThanOrEqual(2);
    for (const t of plan.batch_tokens) expect(t).toBeLessThanOrEqual(budget - ENHANCE_LIMITS.callOverheadTokens);
    const planned = plan.batches.flat().flatMap((i) => i.codes);
    const deferred = plan.deferred.flatMap((d) => d.codes);
    expect([...planned, ...deferred].sort()).toEqual(many.map((c) => c.code).sort());
    expect(deferred.length).toBeGreaterThan(0);
    expect(plan.deferred[0].reason).toBe('over_call_budget');
  });
  it('a cluster finding is split by case across calls (one finding, several batches)', () => {
    const plan = planBatches({ ...flagged(14), budget_tokens: 1_200, max_calls: 5 });
    const f = plan.batches.flat().filter((i) => i.order.finding_id === 'F-001');
    expect(plan.batches.length).toBeGreaterThan(1);
    expect(f.length).toBe(plan.batches.length);
  });
  it('a unit that can never fit one call is deferred with its own reason', () => {
    const plan = planBatches({ ...flagged(2, 'detailed'), budget_tokens: 400, max_calls: 3 });
    expect(plan.batches).toHaveLength(0);
    expect(plan.deferred[0].reason).toBe('exceeds_single_call_budget');
  });
  it('the 12-flagged-case "detailed" scenario that overflowed one call is now several bounded calls', () => {
    const budget = Math.floor(8_192 * 0.55);
    const plan = planBatches({ ...flagged(12, 'detailed'), budget_tokens: budget, max_calls: 3 });
    expect(plan.batches.length).toBeGreaterThanOrEqual(1);
    for (const t of plan.batch_tokens) expect(t).toBeLessThanOrEqual(budget);
    for (const b of plan.batches) expect(new Set(b.flatMap((i) => i.codes)).size).toBeLessThanOrEqual(ENHANCE_LIMITS.maxTargetCases);
  });
  it('new cases (ADD/SPLIT) are capped per run', () => {
    const adds = orders(...Array.from({ length: 12 }, (_, i) => raw({ rule: 'Q26', kind: 'missing_case', action: 'ADD', scope: 'suite', test_case_codes: [], fields_affected: [], issue: `atom ${WORDS[i]}`, gap_spec: { category: 'negative', condition: 'c', source_ref: `A_${i}` } })));
    const plan = planBatches({ orders: adds, cases: clean, detail_level: 'standard', budget_tokens: 9_000, max_calls: 5 });
    expect(plan.batches.flat().length).toBe(ENHANCE_LIMITS.maxNewCasesPerRun);
    expect(plan.deferred.reduce((n, d) => n + (d.reason === 'new_case_cap_per_run' ? 1 : 0), 0)).toBe(12 - ENHANCE_LIMITS.maxNewCasesPerRun);
  });
});

describe('applyPatchSet: only named fields change, each checked against the standard', () => {
  const tc = clean[2]; // 5 steps
  const ctx = { detail_level: 'standard', atom_ids: new Set(['A_UI_NAME', 'A_RULE_LOGIN']) };
  const only = (...f: any[]) => new Set<any>(f);

  it('a field the findings did not name is rejected and the case stays identical', () => {
    const r = applyPatchSet(tc, { title: 'Hijacked', steps: tc.steps }, only('steps'), ctx);
    expect(r.rejected).toContain('field_not_allowed:title');
    expect(r.test_case.title).toBe(tc.title);
    expect(r.changed).toEqual([]);
  });
  it('unchanged fields are identical by construction; a no-op patch changes nothing', () => {
    const r = applyPatchSet(tc, { final_expected_result: 'Kết quả mới có thể kiểm chứng được' }, only('final_expected_result'), ctx);
    expect(r.changed).toEqual(['final_expected_result']);
    expect({ ...r.test_case, final_expected_result: tc.final_expected_result }).toEqual(tc);
  });
  it('steps: renumbered 1..n; outside min..max rejected unless strictly closer to the range', () => {
    const rules = getDetailLevelRules('standard');
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ step_number: 99, action: `Hành động ${i} trên field 'A'`, expected_result: `Kết quả ${i} hiển thị 'B'` }));
    expect(applyPatchSet(tc, { steps: mk(7) }, only('steps'), ctx).test_case.steps.map((s) => s.step_number)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(applyPatchSet(tc, { steps: mk(rules.maxSteps + 3) }, only('steps'), ctx).rejected[0]).toMatch(/steps_outside/);
    const short = { ...tc, steps: tc.steps.slice(0, 2) };
    expect(applyPatchSet(short, { steps: mk(4) }, only('steps'), ctx).changed).toEqual(['steps']); // 4 < min 5 but closer than 2
    expect(applyPatchSet(short, { steps: mk(1) }, only('steps'), ctx).rejected[0]).toMatch(/steps_outside/); // further away
  });
  it('test_data_entries REPLACES test_data and every value is a string', () => {
    const r = applyPatchSet(tc, { test_data_entries: [{ field: 'email', value: 'a@b.co' }, { field: 'qty', value: 3 as never }] }, only('test_data'), ctx);
    expect(r.test_case.test_data).toEqual({ email: 'a@b.co', qty: '3' });
    expect(applyPatchSet(tc, { test_data_entries: [] }, only('test_data'), ctx).rejected).toContain('empty_test_data');
  });
  it('source_requirement_ids: extended, never dropped, only real atoms; REPLACE is allowed only when asked for', () => {
    const extend = applyPatchSet(tc, { source_requirement_ids: ['A_RULE_LOGIN', 'A_FAKE'] }, only('source_requirement_ids'), ctx);
    expect(extend.test_case.source_requirement_ids).toEqual(['A_UI_NAME', 'A_RULE_LOGIN']);
    const drop = applyPatchSet(tc, { source_requirement_ids: [] }, only('source_requirement_ids'), ctx);
    expect(drop.test_case.source_requirement_ids).toEqual(['A_UI_NAME']);
    const replace = applyPatchSet(tc, { source_requirement_ids: ['A_RULE_LOGIN'] }, only('source_requirement_ids'), { ...ctx, replace_ids: true });
    expect(replace.test_case.source_requirement_ids).toEqual(['A_RULE_LOGIN']);
  });
  it('category/priority must be valid values; empty text is rejected', () => {
    expect(applyPatchSet(tc, { priority: 'Urgent' }, only('priority'), ctx).rejected[0]).toMatch(/invalid_priority/);
    expect(applyPatchSet(tc, { category: 'nonsense' }, only('category'), ctx).rejected[0]).toMatch(/invalid_category/);
    expect(applyPatchSet(tc, { title: '   ' }, only('title'), ctx).rejected).toContain('empty_title');
  });
});

describe('applyWorkOutputs: patch targets and the ADD / SPLIT guard', () => {
  const addOrder = (over: Partial<RawFinding> = {}) =>
    orders(raw({ rule: 'Q26', kind: 'missing_case', action: 'ADD', scope: 'suite', test_case_codes: [], fields_affected: [], gap_spec: { category: 'negative', condition: 'only active', source_ref: 'A_RULE_ACTIVE' }, ...over }));
  const run = (o: WorkOrder[], out: EnhanceWorkOutput, cases = clean) =>
    applyWorkOutputs({ previous: emptyOutcome(cases), orders: o, outputs: [out], detail_level: 'standard', documents: SEEDED_CTX.documents });
  const fresh = (over: Partial<GeneratedTestCase> = {}): GeneratedTestCase => ({
    ...clean[7], code: 'TC_ANY_001', title: 'Tài khoản bị tạm ngưng không thể đăng nhập vào hệ thống', test_data: { email: 'suspended@company.com', password: 'Str0ng!Pass#1' },
    steps: clean[7].steps.map((s) => ({ ...s, action: s.action.replace('inactive.user@company.com', 'suspended@company.com') })), ...over,
  });

  it('a patch for a case no finding targeted is rejected', () => {
    const r = run(orders(raw()), { ...empty(), patches: [{ code: 'TC_LOGIN_001', set: { title: 'x y z' } }] });
    expect(r.rejected[0].reason).toMatch(/not_a_target/);
  });
  it('an ADD becomes a new case with an APPLICATION-allocated code, citing the source atom', () => {
    const o = addOrder();
    const r = run(o, { ...empty(), new_cases: [{ finding_id: o[0].finding_id, test_case: fresh() }] });
    expect(r.created).toHaveLength(1);
    expect(clean.some((c) => c.code === r.created[0].code)).toBe(false);
    expect(r.test_cases.find((c) => c.code === r.created[0].code)!.source_requirement_ids).toContain('A_RULE_ACTIVE');
  });
  it('a new case without an ADD/SPLIT finding, a duplicate, and an over-limit second case are rejected', () => {
    const o = addOrder();
    expect(run(o, { ...empty(), new_cases: [{ finding_id: 'F-999', test_case: fresh() }] }).rejected[0].reason).toMatch(/without_ADD_or_SPLIT/);
    const dup = run(o, { ...empty(), new_cases: [{ finding_id: o[0].finding_id, test_case: { ...clean[4], code: 'TC_X_9', title: 'Tiêu đề khác nhau hoàn toàn ở đây' } }] });
    expect(dup.rejected[0].reason).toMatch(/duplicate_of:TC_LOGIN_005/);
    const two = run(o, { ...empty(), new_cases: [{ finding_id: o[0].finding_id, test_case: fresh() }, { finding_id: o[0].finding_id, test_case: fresh({ title: 'Một kịch bản khác hẳn về tài khoản bị khóa', test_data: { email: 'z@company.com', password: 'Str0ng!Pass#1' } }) }] });
    expect(two.created).toHaveLength(1);
    expect(two.rejected.some((r) => /over_limit/.test(r.reason))).toBe(true);
  });
  it('a Q20 shortfall must be filled in the category it asked for', () => {
    const o = orders(raw({ rule: 'Q20', kind: 'missing_case', action: 'ADD', scope: 'category', test_case_codes: [], fields_affected: [], gap_spec: { category: 'boundary', condition: 'c', source_ref: 'config:perCategoryMin' } }));
    expect(run(o, { ...empty(), new_cases: [{ finding_id: o[0].finding_id, test_case: fresh() }] }).rejected[0].reason).toMatch(/category_mismatch/);
  });
  it('SPLIT: the original keeps its code; a child may resemble its parent but not duplicate anything else', () => {
    const o = orders(raw({ action: 'SPLIT', test_case_codes: ['TC_LOGIN_001'], fields_affected: ['steps'] }));
    const child = { ...clean[0], code: 'TC_C_1', title: clean[0].title + ' (tách)', test_data: { email: 'child@company.com', password: 'Str0ng!Pass#1' } };
    const r = run(o, { ...empty(), patches: [{ code: 'TC_LOGIN_001', set: { steps: clean[0].steps } }], new_cases: [{ finding_id: o[0].finding_id, test_case: child }] });
    expect(r.created).toHaveLength(1);
    expect(r.test_cases.some((c) => c.code === 'TC_LOGIN_001')).toBe(true);
  });
});

describe('executeRemovals: the model never deletes; the application does, and only safely', () => {
  const rm = (drop: string, survivor: string, over: Partial<RawFinding> = {}) =>
    orders(raw({ rule: 'Q25', kind: 'hygiene', action: 'REMOVE', test_case_codes: [drop], survivor_code: survivor, fields_affected: [], ...over }));
  const dupSuite = () => [...clean, { ...JSON.parse(JSON.stringify(clean[8])), code: 'TC_LOGIN_014', title: 'Bỏ trống cả hai field thì không gửi' }] as GeneratedTestCase[];
  const exec = (cases: GeneratedTestCase[], o: WorkOrder[]) => executeRemovals({ cases, orders: o, documents: SEEDED_CTX.documents, per_category_min: 4 });

  it('removes a true duplicate and folds its citations into the survivor', () => {
    const r = exec(dupSuite(), rm('TC_LOGIN_014', 'TC_LOGIN_009'));
    expect(r.removed).toHaveLength(1);
    expect(r.test_cases.some((c) => c.code === 'TC_LOGIN_014')).toBe(false);
  });
  it('refuses below High confidence, and when the removal would reduce atom coverage', () => {
    expect(exec(dupSuite(), rm('TC_LOGIN_014', 'TC_LOGIN_009', { confidence: 'Medium' })).refused[0].reason).toBe('removal_needs_High_confidence');
    // P is the only case exercising a distinctive atom; "removing it as a duplicate of Q" would lose that atom,
    // even though Q inherits P's citation (an inherited citation without evidence does not count as coverage).
    const doc = { ...SEEDED_CTX.documents[0], atoms: [{ atom_id: 'A_Z', atom_type: 'rule' as const, label: 'Hạn mức zebra', detail: 'vượt hạn mức zebra thì từ chối giao dịch' }] };
    const p = { ...clean[4], code: 'TC_P_1', title: 'Vượt hạn mức zebra thì từ chối giao dịch', category: 'negative' as const, source_requirement_ids: ['A_Z'], steps: clean[4].steps.map((s) => ({ ...s, action: s.action + ' zebra' })), final_expected_result: 'Giao dịch bị từ chối vì vượt hạn mức zebra' };
    const q = { ...clean[6], code: 'TC_Q_1', source_requirement_ids: [] };
    const r = executeRemovals({ cases: [p, q, ...clean.slice(0, 3)], orders: rm('TC_P_1', 'TC_Q_1'), documents: [doc], per_category_min: 1 });
    expect(r.refused[0].reason).toBe('would_reduce_atom_coverage');
  });
  it('refuses when a required category would fall below its minimum', () => {
    const r = exec(clean.filter((c) => c.code !== 'TC_LOGIN_001'), rm('TC_LOGIN_002', 'TC_LOGIN_003')); // positive: 3 -> 2 (< 4)... was already < min, so allowed? no: only a drop from >= min is refused
    expect(r.removed.length + r.refused.length).toBe(1);
    const atMin = exec(clean, rm('TC_LOGIN_002', 'TC_LOGIN_001')); // positive is exactly 4 -> 3
    expect(atMin.refused[0].reason).toBe('would_drop_positive_below_minimum');
  });
});

// ── Orchestrator behaviours ────────────────────────────────────────────────

const Q02_BROKEN = (): GeneratedTestCase[] => {
  const s = JSON.parse(JSON.stringify(clean)) as GeneratedTestCase[];
  s[2].steps = s[2].steps.slice(0, 2).map((x, i) => ({ ...x, step_number: i + 1 }));
  return s;
};
const base = (cases: GeneratedTestCase[], callModel: CallModel, over: Record<string, unknown> = {}) =>
  runEnhanceWork({ cases, client_findings: [], strengths: [], open_questions: [], l0: SEEDED_CTX, budget_tokens: 4_000, callModel, ...over });
const fixQ02: CallModel = async ({ batch }) => ({
  data: {
    ...empty(),
    patches: batch.flatMap((b) => b.codes.map((code) => ({ code, set: { steps: clean.find((c) => c.code === code)!.steps } }))),
    resolutions: batch.map((b) => ({ finding_id: b.order.finding_id, status: 'FIXED' as const, test_case_codes: b.codes, note: '' })),
  },
  model: 'm', truncated: false,
});

describe('orchestrator: resolution coverage, retry, declines, rollback, budget', () => {
  it('happy path: FIXED, one call, mechanical flags gone', async () => {
    const r = await base(Q02_BROKEN(), fixQ02);
    // (the 2-step case also loses the literal 'Tên người dùng' label -> a Minor Q27 finding, advisory by default)
    expect(r.resolutions.find((x) => x.rule === 'Q02')!.status).toBe('FIXED');
    expect(r.resolutions.filter((x) => x.rule !== 'Q02').every((x) => x.status === 'ADVISORY')).toBe(true);
    expect(r.calls).toBe(1);
    expect(r.delta.mechanical_after.total).toBe(0);
  });

  it('a finding the model forgot gets ONE bounded retry containing only it', async () => {
    const seen: boolean[] = [];
    const callModel: CallModel = async (args) => {
      seen.push(args.retry);
      return args.retry ? fixQ02(args) : { data: { ...empty(), patches: [{ code: 'TC_LOGIN_003', set: { steps: clean[2].steps } }] }, model: 'm', truncated: false }; // patched, but no resolution
    };
    const r = await base(Q02_BROKEN(), callModel);
    expect(seen).toEqual([false]); // patched => counts as resolved by evidence of change; no retry needed
    expect(r.resolutions.find((x) => x.rule === 'Q02')!.status).toBe('FIXED');

    const seen2: boolean[] = [];
    const lazy: CallModel = async (args) => { seen2.push(args.retry); return args.retry ? fixQ02(args) : { data: empty(), model: 'm', truncated: false }; };
    const r2 = await base(Q02_BROKEN(), lazy);
    expect(seen2).toEqual([false, true]);
    expect(r2.resolutions.find((x) => x.rule === 'Q02')!.status).toBe('FIXED');
    expect(r2.calls).toBe(2);
  });

  it('after the retry, what is still unresolved is REPORTED, not hidden (exactly one retry)', async () => {
    let n = 0;
    const never: CallModel = async () => { n++; return { data: empty(), model: 'm', truncated: false }; };
    const r = await base(Q02_BROKEN(), never);
    expect(n).toBe(2);
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved[0].rule).toBe('Q02');
    expect(r.unresolved[0].note).toMatch(/no resolution returned/);
  });

  it('a claimed FIXED with no applied change is downgraded to UNRESOLVED (claims are verified)', async () => {
    const liar: CallModel = async ({ batch }) => ({ data: { ...empty(), resolutions: batch.map((b) => ({ finding_id: b.order.finding_id, status: 'FIXED' as const, test_case_codes: b.codes, note: '' })) }, model: 'm', truncated: false });
    const r = await base(Q02_BROKEN(), liar);
    const q02 = r.resolutions.find((x) => x.rule === 'Q02')!;
    expect(q02.status).toBe('UNRESOLVED');
    expect(q02.note).toMatch(/claimed FIXED but no change was applied/);
  });

  it('DECLINED with a reason is honoured and becomes a waiver; DECLINED without a reason is not', async () => {
    const decline = (note: string): CallModel => async ({ batch }) => ({ data: { ...empty(), resolutions: batch.map((b) => ({ finding_id: b.order.finding_id, status: 'DECLINED' as const, test_case_codes: b.codes, note })) }, model: 'm', truncated: false });
    const ok = await base(Q02_BROKEN(), decline('contradicts source: the spec defines a 2-step login'));
    expect(ok.resolutions.find((x) => x.rule === 'Q02')!.status).toBe('DECLINED');
    expect(ok.waivers).toHaveLength(1);
    expect(ok.waivers[0]).toMatchObject({ rule: 'Q02', test_case_codes: ['TC_LOGIN_003'] });
    const bad = await base(Q02_BROKEN(), decline(''));
    expect(bad.resolutions.find((x) => x.rule === 'Q02')!.status).toBe('UNRESOLVED');
    expect(bad.waivers).toHaveLength(0);
  });

  it('a revision that makes a code check WORSE is rolled back (the original case is restored)', async () => {
    const worse: CallModel = async ({ batch }) => ({
      data: { ...empty(), patches: batch.flatMap((b) => b.codes.map((code) => ({ code, set: { steps: Array.from({ length: 5 }, (_, i) => ({ step_number: i + 1, action: 'N/A', expected_result: 'TBD' })) } }))), resolutions: batch.map((b) => ({ finding_id: b.order.finding_id, status: 'FIXED' as const, test_case_codes: b.codes, note: '' })) },
      model: 'm', truncated: false,
    });
    const broken = Q02_BROKEN();
    const r = await base(broken, worse);
    expect(r.test_cases.find((c) => c.code === 'TC_LOGIN_003')).toEqual(broken[2]);
    expect(r.resolutions.find((x) => x.rule === 'Q02')!.status).toBe('ROLLED_BACK');
    expect(r.issues.some((i) => i.code === 'enhance_revision_rolled_back')).toBe(true);
  });

  it('a revision that lowers atom coverage is rolled back even if it looks cleaner', async () => {
    const s = JSON.parse(JSON.stringify(clean)) as GeneratedTestCase[];
    s[7].source_requirement_ids = ['A_RULE_ACTIVE', 'A_RULE_LOCK']; // bogus second citation (Q15) on the ONLY case covering A_RULE_ACTIVE
    const dropAll: CallModel = async ({ batch }) => ({
      data: { ...empty(), patches: batch.flatMap((b) => b.codes.map((code) => ({ code, set: { source_requirement_ids: [] } }))), resolutions: batch.map((b) => ({ finding_id: b.order.finding_id, status: 'FIXED' as const, test_case_codes: b.codes, note: '' })) },
      model: 'm', truncated: false,
    });
    const r = await base(s, dropAll);
    expect(r.test_cases.find((c) => c.code === 'TC_LOGIN_008')!.source_requirement_ids).toEqual(['A_RULE_ACTIVE', 'A_RULE_LOCK']);
    expect(r.delta.atom_coverage_after!).toBeGreaterThanOrEqual(r.delta.atom_coverage_before!);
    expect(r.resolutions.find((x) => x.rule === 'Q15')!.status).toBe('ROLLED_BACK');
  });

  it('a new case that violates the standard is dropped, not merged', async () => {
    const s = clean.filter((c) => c.code !== 'TC_LOGIN_008');
    const bad: CallModel = async ({ batch }) => ({
      data: { ...empty(), new_cases: batch.filter((b) => b.order.action === 'ADD').map((b) => ({ finding_id: b.order.finding_id, test_case: { ...clean[7], code: 'TC_BAD_1', steps: clean[7].steps.slice(0, 1), source_requirement_ids: ['A_RULE_ACTIVE'] } })), resolutions: batch.map((b) => ({ finding_id: b.order.finding_id, status: 'ADDED' as const, test_case_codes: [], note: '' })) },
      model: 'm', truncated: false,
    });
    const r = await base(s, bad);
    expect(r.test_cases).toHaveLength(s.length);
    expect(r.issues.some((i) => i.code === 'enhance_new_case_rejected')).toBe(true);
  });

  it('time budget exhausted: no model call, everything reported as deferred, suite untouched', async () => {
    let called = 0;
    const r = await base(Q02_BROKEN(), async (a) => { called++; return fixQ02(a); }, { canStartCall: () => false });
    expect(called).toBe(0);
    expect(r.deferred[0].reason).toBe('time_budget');
    expect(r.resolutions.find((x) => x.rule === 'Q02')!.status).toBe('DEFERRED');
    expect(r.test_cases).toEqual(Q02_BROKEN());
  });

  it('a truncated reply is reported; what was not returned stays unresolved', async () => {
    const trunc: CallModel = async () => ({ data: empty(), model: 'm', truncated: true });
    const r = await base(Q02_BROKEN(), trunc);
    expect(r.truncated).toBe(true);
    expect(r.issues.some((i) => i.code === 'truncated_response')).toBe(true);
    expect(r.unresolved).toHaveLength(1);
  });

  it('never exceeds maxCallsPerRun, whatever the model does', async () => {
    let n = 0;
    const r = await base(Q02_BROKEN(), async () => { n++; return { data: empty(), model: 'm', truncated: false }; }, { budget_tokens: 600 });
    expect(n).toBeLessThanOrEqual(ENHANCE_LIMITS.maxCallsPerRun);
    expect(r.calls).toBe(n);
  });

  it('selected_fingerprints: only the chosen findings are applied', async () => {
    const s = Q02_BROKEN();
    s[3].preconditions = [];
    const all = await base(s, fixQ02, { selection: { min_severity: 'Minor' } });
    const q02 = all.work_orders.find((o) => o.rule === 'Q02')!;
    const picked = await base(s, fixQ02, { selection: { selected_fingerprints: [q02.fingerprint] } });
    expect(picked.resolutions.find((x) => x.rule === 'Q02')!.status).toBe('FIXED');
    expect(picked.resolutions.find((x) => x.rule === 'Q05')!.status).toBe('ADVISORY');
  });

  it('semantic findings from the client are re-clamped: a forged finding about a ghost case is ignored', async () => {
    const forged = assignIds([{ finding: raw({ rule: 'Q13', test_case_codes: ['TC_GHOST'], fields_affected: ['title'] }), origin: 'semantic' }]);
    const r = await base(clean, fixQ02, { client_findings: forged });
    expect(r.work_orders).toHaveLength(0);
    expect(r.calls).toBe(0);
  });

  it('the fresh run reports previous_run fingerprints for the next Review (comparison)', async () => {
    const r = await base(Q02_BROKEN(), fixQ02);
    const q02 = r.work_orders.find((o) => o.rule === 'Q02')!;
    expect(r.previous_run.fingerprints).toContain(q02.fingerprint);
    expect(r.previous_run.resolved_fingerprints).toEqual([q02.fingerprint]);
  });
});

describe('verifying L0 stays a pure function of the suite', () => {
  it('re-running L0 on the same suite gives the same fingerprints (needed for convergence)', () => {
    const a = runL0(Q02_BROKEN(), SEEDED_CTX).findings.map((f) => f.fingerprint);
    const b = runL0(Q02_BROKEN(), SEEDED_CTX).findings.map((f) => f.fingerprint);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(0);
  });
});
