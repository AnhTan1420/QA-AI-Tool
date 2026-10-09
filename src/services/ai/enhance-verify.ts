// ============================================================================
// File: src/services/ai/enhance-verify.ts
// The application-side half of Enhance (L2). The model proposes; this file decides.
//
//   applyWorkOutputs()    patches onto ORIGINAL cases (unchanged fields identical by construction),
//                         field guard, standard check, ADD/SPLIT guard (allocated codes, de-dup, source ref)
//   executeRemovals()     REMOVE is done here, never by the model, and only if coverage cannot drop
//   finalizeResolutions() every finding gets a status; false claims are downgraded
//   verifyMerge()         re-run L0 on the merged suite, roll back regressions, compute the delta
//
// Pure: no env, no clock, no I/O, no zod (the route validates model JSON before calling in).
// ============================================================================

import { CATEGORY_VALUES, type GeneratedTestCase } from '@/models/validators/test-case';
import type { ParsedDocument } from '@/models/validators/document';
import { collectAtomInventory, computeDocumentCoverage } from '@/services/documents/coverage';
import { ENHANCE_LIMITS, SEVERITY_WEIGHTS, getDetailLevelRules, getRule } from '@/services/ai/quality-standards';
import { TestCaseCodeAllocator } from '@/services/ai/test-case-validation';
import { DUPLICATE_TITLE_JACCARD, scenarioSignature, titleSimilarity } from '@/services/ai/review-facts';
import { runL0, type L0Context } from '@/services/ai/review-pipeline';
import { clip, computeScore, makeWaiver, type CaseField, type ReviewFinding, type Waiver } from '@/services/ai/review-findings';
import {
  allowedFieldsByCode,
  idsReplaceCodes,
  type Advisory,
  type Deferred,
  type EnhanceWorkOutput,
  type FinalResolution,
  type ModelResolutionStatus,
  type PatchSet,
  type WorkOrder,
} from '@/services/ai/enhance-work';

const PRIORITIES = ['Critical', 'Major', 'Normal'] as const;

export type RejectedChange = { code: string; reason: string };

// ── Patches ────────────────────────────────────────────────────────────────

function rangeDistance(n: number, min: number, max: number): number {
  return n < min ? min - n : n > max ? n - max : 0;
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Apply ONE patch set onto the ORIGINAL case. Only fields in `allowed` may change; each field is
 * validated against the generation standard. Returns the new case, the fields that really changed,
 * and a reason for every rejected field. Unchanged fields are identical by construction.
 */
export function applyPatchSet(
  original: GeneratedTestCase,
  set: PatchSet,
  allowed: ReadonlySet<CaseField>,
  ctx: { detail_level: string; atom_ids: ReadonlySet<string> | null; replace_ids?: boolean },
): { test_case: GeneratedTestCase; changed: CaseField[]; rejected: string[] } {
  const rules = getDetailLevelRules(ctx.detail_level);
  const next: GeneratedTestCase = { ...original };
  const rejected: string[] = [];
  const guard = (field: CaseField): boolean => {
    if (allowed.has(field)) return true;
    rejected.push(`field_not_allowed:${field}`);
    return false;
  };

  if (set.title !== undefined && guard('title')) {
    const v = set.title.trim();
    if (v) next.title = v;
    else rejected.push('empty_title');
  }
  if (set.preconditions !== undefined && guard('preconditions')) {
    const v = set.preconditions.map((p) => String(p).trim()).filter(Boolean);
    if (v.length > 0) next.preconditions = v;
    else rejected.push('empty_preconditions');
  }
  if (set.test_data_entries !== undefined && guard('test_data')) {
    const data: Record<string, string> = {};
    for (const e of set.test_data_entries) {
      const key = String(e.field ?? '').trim();
      if (key) data[key] = String(e.value ?? '');
    }
    if (Object.keys(data).length > 0) next.test_data = data;
    else rejected.push('empty_test_data');
  }
  if (set.steps !== undefined && guard('steps')) {
    const steps = set.steps
      .map((s) => ({ action: String(s.action ?? '').trim(), expected_result: String(s.expected_result ?? '').trim() }))
      .filter((s) => s.action && s.expected_result)
      .map((s, i) => ({ step_number: i + 1, ...s }));
    const before = rangeDistance(original.steps.length, rules.minSteps, rules.maxSteps);
    const after = rangeDistance(steps.length, rules.minSteps, rules.maxSteps);
    if (steps.length === 0) rejected.push('empty_steps');
    // In range, or strictly closer to the range than the original: never push a case further out.
    else if (after === 0 || after < before) next.steps = steps;
    else rejected.push(`steps_outside_${rules.minSteps}-${rules.maxSteps}:${steps.length}`);
  }
  if (set.final_expected_result !== undefined && guard('final_expected_result')) {
    const v = set.final_expected_result.trim();
    if (v) next.final_expected_result = v;
    else rejected.push('empty_final_expected_result');
  }
  if (set.priority !== undefined && guard('priority')) {
    if ((PRIORITIES as readonly string[]).includes(set.priority)) next.priority = set.priority as GeneratedTestCase['priority'];
    else rejected.push(`invalid_priority:${set.priority}`);
  }
  if (set.category !== undefined && guard('category')) {
    if ((CATEGORY_VALUES as readonly string[]).includes(set.category)) next.category = set.category as GeneratedTestCase['category'];
    else rejected.push(`invalid_category:${set.category}`);
  }
  if (set.source_requirement_ids !== undefined && guard('source_requirement_ids')) {
    if (ctx.replace_ids) {
      // A Q15/Q12 finding asked for a citation to go: REPLACE, keeping only real atoms.
      const kept = [...new Set(set.source_requirement_ids)];
      next.source_requirement_ids = ctx.atom_ids ? kept.filter((id) => ctx.atom_ids!.has(id)) : kept;
    } else {
      // Preserved or extended, never silently dropped; only real atoms survive.
      const merged = [...new Set([...(original.source_requirement_ids ?? []), ...set.source_requirement_ids])];
      next.source_requirement_ids = ctx.atom_ids ? merged.filter((id) => ctx.atom_ids!.has(id) || (original.source_requirement_ids ?? []).includes(id)) : merged;
    }
  }

  const fields: CaseField[] = ['title', 'preconditions', 'test_data', 'steps', 'final_expected_result', 'priority', 'category', 'source_requirement_ids'];
  const changed = fields.filter((f) => !sameJson((next as Record<string, unknown>)[f], (original as Record<string, unknown>)[f]));
  return { test_case: next, changed, rejected };
}

export type ApplyOutcome = {
  test_cases: GeneratedTestCase[];
  /** code -> fields really changed. */
  patched: Map<string, CaseField[]>;
  /** New cases with the code the APPLICATION allocated. */
  created: { code: string; finding_id: string }[];
  rejected: RejectedChange[];
  /** What the model CLAIMED, per finding (merged across calls). The application verifies the claims. */
  claims: Map<string, { status: ModelResolutionStatus; note: string; codes: string[] }[]>;
};

export function emptyOutcome(cases: GeneratedTestCase[]): ApplyOutcome {
  return { test_cases: cases, patched: new Map(), created: [], rejected: [], claims: new Map() };
}

/**
 * Merge model outputs into the suite under hard rules. Can be called more than once (the second
 * call is the bounded retry): `previous` carries state forward.
 */
export function applyWorkOutputs(input: {
  previous: ApplyOutcome;
  orders: readonly WorkOrder[];
  outputs: readonly EnhanceWorkOutput[];
  detail_level: string;
  documents: ParsedDocument[];
  /** Cap on new cases for the whole run (previous creations count). */
  max_new_cases?: number;
}): ApplyOutcome {
  const L = ENHANCE_LIMITS;
  const prev = input.previous;
  const cases = prev.test_cases.map((c) => ({ ...c }));
  const byCode = new Map(cases.map((c) => [c.code, c]));
  const originalByCode = new Map(prev.test_cases.map((c) => [c.code, c]));
  const patched = new Map(prev.patched);
  const created = [...prev.created];
  const rejected = [...prev.rejected];
  const claims = new Map([...prev.claims].map(([k, v]) => [k, [...v]]));
  const allowed = allowedFieldsByCode(input.orders);
  const replaceIds = idsReplaceCodes(input.orders);
  const atomIds = (() => {
    const ids = collectAtomInventory(input.documents).ordered.map((a) => a.atom_id);
    return ids.length > 0 ? new Set(ids) : null;
  })();
  const orderById = new Map(input.orders.map((o) => [o.finding_id, o]));
  const allocator = new TestCaseCodeAllocator(cases);
  const maxNew = input.max_new_cases ?? L.maxNewCasesPerRun;

  for (const out of input.outputs) {
    for (const patch of out.patches) {
      const original = byCode.get(patch.code);
      const fields = allowed.get(patch.code);
      if (!original || !fields) {
        rejected.push({ code: patch.code, reason: 'not_a_target: no finding asked for a change to this case' });
        continue;
      }
      const result = applyPatchSet(original, patch.set, fields, { detail_level: input.detail_level, atom_ids: atomIds, replace_ids: replaceIds.has(patch.code) });
      for (const r of result.rejected) rejected.push({ code: patch.code, reason: r });
      if (result.changed.length === 0) continue;
      const idx = cases.findIndex((c) => c.code === patch.code);
      cases[idx] = result.test_case;
      byCode.set(patch.code, result.test_case);
      patched.set(patch.code, [...new Set([...(patched.get(patch.code) ?? []), ...result.changed])]);
    }

    const perFinding = new Map<string, number>();
    for (const created_ of created) perFinding.set(created_.finding_id, (perFinding.get(created_.finding_id) ?? 0) + 1);
    for (const nc of out.new_cases) {
      const order = orderById.get(nc.finding_id);
      const cand = nc.test_case;
      const reject = (reason: string) => rejected.push({ code: cand.code, reason });
      if (!order || (order.action !== 'ADD' && order.action !== 'SPLIT')) { reject('new_case_without_ADD_or_SPLIT_finding'); continue; }
      const limit = order.action === 'ADD' ? 1 : L.maxNewCasesPerSplit;
      if ((perFinding.get(order.finding_id) ?? 0) >= limit) { reject(`over_limit_for_${order.finding_id}`); continue; }
      if (created.length >= maxNew) { reject('new_case_cap_per_run'); continue; }
      // The category IS the finding for shortfalls (Q20/Q22); for atom-grounded ADDs (Q26/Q27, Q10, Q23...) the atom is.
      if (order.action === 'ADD' && order.gap_spec && (order.rule === 'Q20' || order.rule === 'Q22') && cand.category !== order.gap_spec.category) {
        reject(`category_mismatch: finding asked for ${order.gap_spec.category}`);
        continue;
      }
      const parents = new Set(order.action === 'SPLIT' ? order.test_case_codes : []);
      const sig = scenarioSignature(cand);
      const dup = cases.find(
        (c) => scenarioSignature(c) === sig || (!parents.has(c.code) && titleSimilarity(c.title, cand.title) >= DUPLICATE_TITLE_JACCARD),
      );
      if (dup) { reject(`duplicate_of:${dup.code}`); continue; }

      const ids = new Set((cand.source_requirement_ids ?? []).filter((id) => !atomIds || atomIds.has(id)));
      const ref = order.gap_spec?.source_ref;
      if (ref && atomIds?.has(ref)) ids.add(ref); // an ADD grounded in an atom must cite it
      const code = allocator.allocate(cand.code);
      const fresh: GeneratedTestCase = {
        ...cand,
        code,
        steps: cand.steps.map((s, i) => ({ ...s, step_number: i + 1 })),
        ...(ids.size > 0 ? { source_requirement_ids: [...ids] } : {}),
      };
      cases.push(fresh);
      byCode.set(code, fresh);
      created.push({ code, finding_id: order.finding_id });
      perFinding.set(order.finding_id, (perFinding.get(order.finding_id) ?? 0) + 1);
    }

    for (const r of out.resolutions) {
      if (!orderById.has(r.finding_id)) continue;
      const list = claims.get(r.finding_id) ?? [];
      list.push({ status: r.status, note: clip(r.note, L.maxResolutionNoteChars), codes: r.test_case_codes });
      claims.set(r.finding_id, list);
    }
  }
  // `originalByCode` is intentionally unused beyond documentation: patches always start from the
  // CURRENT case, whose untouched fields are the originals by construction.
  void originalByCode;
  return { test_cases: cases, patched, created, rejected, claims };
}

// ── Removals ───────────────────────────────────────────────────────────────

export type RemovalOutcome = {
  test_cases: GeneratedTestCase[];
  removed: { code: string; survivor: string; finding_id: string }[];
  refused: { finding_id: string; code: string; reason: string }[];
};

export function executeRemovals(input: {
  cases: GeneratedTestCase[];
  orders: readonly WorkOrder[];
  documents: ParsedDocument[];
  per_category_min: number;
}): RemovalOutcome {
  let cases = input.cases;
  const removed: RemovalOutcome['removed'] = [];
  const refused: RemovalOutcome['refused'] = [];

  for (const o of input.orders) {
    const drop = o.test_case_codes[0];
    const survivorCode = o.survivor_code;
    const refuse = (reason: string) => refused.push({ finding_id: o.finding_id, code: drop ?? '', reason });
    const dropCase = cases.find((c) => c.code === drop);
    const survivor = cases.find((c) => c.code === survivorCode);
    if (!dropCase || !survivor) { refuse('case_or_survivor_not_found'); continue; }
    if (o.confidence !== 'High') { refuse('removal_needs_High_confidence'); continue; }

    const before = computeDocumentCoverage(input.documents, cases)?.covered_atoms ?? 0;
    const merged: GeneratedTestCase = {
      ...survivor,
      ...(dropCase.source_requirement_ids?.length || survivor.source_requirement_ids?.length
        ? { source_requirement_ids: [...new Set([...(survivor.source_requirement_ids ?? []), ...(dropCase.source_requirement_ids ?? [])])] }
        : {}),
    };
    const candidate = cases.filter((c) => c.code !== drop).map((c) => (c.code === survivor.code ? merged : c));
    const after = computeDocumentCoverage(input.documents, candidate)?.covered_atoms ?? 0;
    if (after < before) { refuse('would_reduce_atom_coverage'); continue; }

    const countBefore = cases.filter((c) => c.category === dropCase.category).length;
    const countAfter = countBefore - 1;
    if (countAfter === 0 || (countBefore >= input.per_category_min && countAfter < input.per_category_min)) {
      refuse(`would_drop_${dropCase.category}_below_minimum`);
      continue;
    }
    cases = candidate;
    removed.push({ code: drop, survivor: survivor.code, finding_id: o.finding_id });
  }
  return { test_cases: cases, removed, refused };
}

// ── Resolutions ────────────────────────────────────────────────────────────

/** Codes of a model-handled finding that were actually changed (and not rolled back). */
function appliedCodes(o: WorkOrder, outcome: ApplyOutcome, rolledBack: ReadonlySet<string>): string[] {
  if (o.action === 'ADD') return outcome.created.filter((c) => c.finding_id === o.finding_id && !rolledBack.has(c.code)).map((c) => c.code);
  const hit = o.test_case_codes.filter((code) => {
    if (rolledBack.has(code)) return false;
    const fields = outcome.patched.get(code);
    return Boolean(fields && (o.fields_affected.length === 0 || fields.some((f) => o.fields_affected.includes(f)) || o.action === 'SPLIT'));
  });
  if (o.action === 'SPLIT') {
    const children = outcome.created.filter((c) => c.finding_id === o.finding_id && !rolledBack.has(c.code)).map((c) => c.code);
    return [...new Set([...hit, ...children])];
  }
  return hit;
}

export function finalizeResolutions(input: {
  /** Every finding of this run, actionable or not. */
  all: readonly WorkOrder[];
  actionableModel: readonly WorkOrder[];
  advisory: readonly Advisory[];
  deferred: readonly Deferred[];
  outcome: ApplyOutcome;
  removal: RemovalOutcome;
  rolled_back: ReadonlySet<string>;
  /** Codes whose rollback was caused by verification, per finding source (for the note). */
  rollback_reason?: ReadonlyMap<string, string>;
}): FinalResolution[] {
  const advisoryReason = new Map(input.advisory.map((a) => [a.order.finding_id, a.reason]));
  const deferredBy = new Map<string, Deferred[]>();
  for (const d of input.deferred) deferredBy.set(d.finding_id, [...(deferredBy.get(d.finding_id) ?? []), d]);
  const removedBy = new Map(input.removal.removed.map((r) => [r.finding_id, r]));
  const refusedBy = new Map(input.removal.refused.map((r) => [r.finding_id, r]));
  const modelIds = new Set(input.actionableModel.map((o) => o.finding_id));

  return input.all.map((o): FinalResolution => {
    const base = { finding_id: o.finding_id, fingerprint: o.fingerprint, rule: o.rule };
    if (removedBy.has(o.finding_id)) {
      const r = removedBy.get(o.finding_id)!;
      return { ...base, status: 'REMOVED', test_case_codes: [r.code], note: `removed; ${r.survivor} remains` };
    }
    if (refusedBy.has(o.finding_id)) return { ...base, status: 'ADVISORY', test_case_codes: o.test_case_codes, note: `not removed: ${refusedBy.get(o.finding_id)!.reason}` };
    if (advisoryReason.has(o.finding_id) && !modelIds.has(o.finding_id)) return { ...base, status: 'ADVISORY', test_case_codes: o.test_case_codes, note: advisoryReason.get(o.finding_id)! };
    if (!modelIds.has(o.finding_id)) return { ...base, status: 'ADVISORY', test_case_codes: o.test_case_codes, note: 'not applied' };

    const claims = input.outcome.claims.get(o.finding_id) ?? [];
    const declined = claims.filter((c) => c.status === 'DECLINED' && c.note.trim().length > 0);
    const deferred = deferredBy.get(o.finding_id) ?? [];
    const deferredCodes = new Set(deferred.flatMap((d) => d.codes));
    const applied = appliedCodes(o, input.outcome, input.rolled_back);
    const rolled = (o.action === 'ADD' ? input.outcome.created.filter((c) => c.finding_id === o.finding_id).map((c) => c.code) : o.test_case_codes).filter((c) => input.rolled_back.has(c));
    const expected = o.action === 'ADD' ? [] : o.test_case_codes.filter((c) => !deferredCodes.has(c));
    const note = clip(claims.map((c) => c.note).filter(Boolean).join(' '), ENHANCE_LIMITS.maxResolutionNoteChars);

    if (applied.length > 0) {
      const complete = o.action === 'ADD' || (expected.length > 0 && expected.every((c) => applied.includes(c)));
      const status: ResolutionStatus_ = !complete || deferredCodes.size > 0 ? 'PARTIAL' : o.action === 'ADD' ? 'ADDED' : o.action === 'SPLIT' ? 'SPLIT' : 'FIXED';
      const extra = deferredCodes.size > 0 ? ` ${deferredCodes.size} case(s) deferred to another pass.` : '';
      return { ...base, status, test_case_codes: applied, note: clip(`${note}${extra}`.trim(), ENHANCE_LIMITS.maxResolutionNoteChars) };
    }
    if (rolled.length > 0) {
      return { ...base, status: 'ROLLED_BACK', test_case_codes: rolled, note: input.rollback_reason?.get(rolled[0]) ?? 'the revision made a code check worse and was reverted' };
    }
    if (deferred.length > 0 && expected.length === 0 && o.action !== 'ADD') return { ...base, status: 'DEFERRED', test_case_codes: o.test_case_codes, note: deferred[0].reason };
    if (deferred.length > 0 && o.action === 'ADD') return { ...base, status: 'DEFERRED', test_case_codes: [], note: deferred[0].reason };
    if (declined.length > 0) return { ...base, status: 'DECLINED', test_case_codes: o.test_case_codes, note: declined[0].note };
    // Claimed FIXED/ADDED/SPLIT with no applied change is a false claim: report it, do not believe it.
    const claimed = claims.find((c) => c.status !== 'DECLINED');
    return {
      ...base,
      status: 'UNRESOLVED',
      test_case_codes: o.test_case_codes,
      note: claimed ? `model claimed ${claimed.status} but no change was applied` : claims.length === 0 ? 'no resolution returned' : 'DECLINED without a reason',
    };
  });
}
type ResolutionStatus_ = FinalResolution['status'];

/** Findings the retry should ask about: model-handled, not deferred, still UNRESOLVED. */
export function unresolvedOrders(resolutions: readonly FinalResolution[], actionable: readonly WorkOrder[]): WorkOrder[] {
  const un = new Set(resolutions.filter((r) => r.status === 'UNRESOLVED').map((r) => r.finding_id));
  return actionable.filter((o) => un.has(o.finding_id));
}

/** Declined-with-reason findings become waivers the next Review must honour. */
export function buildWaivers(all: readonly WorkOrder[], resolutions: readonly FinalResolution[]): Waiver[] {
  const byId = new Map(all.map((o) => [o.finding_id, o]));
  return resolutions
    .filter((r) => r.status === 'DECLINED' && r.note.trim().length > 0)
    .map((r) => makeWaiver(byId.get(r.finding_id) as ReviewFinding, r.note));
}

// ── Verification: re-analysis, rollback, delta ─────────────────────────────

function caseFindings(findings: readonly ReviewFinding[], code: string): ReviewFinding[] {
  return findings.filter((f) => f.kind !== 'question' && f.scope === 'case' && f.test_case_codes.includes(code));
}

function caseWeight(findings: readonly ReviewFinding[], code: string): number {
  return findings
    .filter((f) => f.kind !== 'question' && f.scope === 'case' && f.test_case_codes.includes(code))
    .reduce((n, f) => n + SEVERITY_WEIGHTS[f.severity], 0);
}

export type EnhanceDelta = {
  mechanical_before: { Critical: number; Major: number; Minor: number; total: number };
  mechanical_after: { Critical: number; Major: number; Minor: number; total: number };
  mechanical_resolved: number;
  mechanical_introduced: number;
  cases_flagged_before: number;
  cases_flagged_after: number;
  atom_coverage_before: number | null;
  atom_coverage_after: number | null;
  score_before: number;
  score_after: number;
  verdict_before: string;
  verdict_after: string;
  /** The score_after assumes a semantic finding is resolved when the model claimed it AND a change was applied. A re-review is the only proof. */
  score_is_estimate: true;
};

function tally(findings: readonly ReviewFinding[]) {
  const t = { Critical: 0, Major: 0, Minor: 0, total: 0 };
  for (const f of findings) {
    if (f.kind === 'question') continue;
    t[f.severity]++;
    t.total++;
  }
  return t;
}
function flaggedCases(findings: readonly ReviewFinding[]): number {
  const s = new Set<string>();
  for (const f of findings) if (f.kind !== 'question' && f.scope === 'case') f.test_case_codes.forEach((c) => s.add(c));
  return s.size;
}

export type VerifyResult = {
  test_cases: GeneratedTestCase[];
  rolled_back: { code: string; reason: string }[];
  rejected_new: { code: string; reason: string }[];
  rollback_reason: Map<string, string>;
  delta: Omit<EnhanceDelta, 'score_after' | 'verdict_after'> & { l0_after: ReturnType<typeof runL0> };
};

/**
 * Re-run the SAME deterministic analysis on the merged suite. A patched case whose mechanical
 * weight went UP is reverted to its original; a new case that violates a depth rule is dropped;
 * atom coverage may not go down (greedy rollback of the cases that cost coverage).
 */
export function verifyMerge(input: {
  before: GeneratedTestCase[];
  after: GeneratedTestCase[];
  patched_codes: ReadonlySet<string>;
  new_codes: ReadonlySet<string>;
  l0: L0Context;
  semantic_before: readonly ReviewFinding[];
}): VerifyResult {
  const beforeL0 = runL0(input.before, input.l0);
  const origByCode = new Map(input.before.map((c) => [c.code, c]));
  let current = input.after;
  const rolled: VerifyResult['rolled_back'] = [];
  const rejectedNew: VerifyResult['rejected_new'] = [];
  const reasons = new Map<string, string>();

  const revert = (code: string, reason: string) => {
    const original = origByCode.get(code);
    if (!original) return;
    current = current.map((c) => (c.code === code ? original : c));
    rolled.push({ code, reason });
    reasons.set(code, reason);
  };

  // 1) Mechanical regression guard, to a fixed point (a rollback can change duplicates etc.).
  for (let pass = 0; pass < 3; pass++) {
    const l0 = runL0(current, input.l0);
    let changed = false;
    for (const code of input.patched_codes) {
      if (rolled.some((r) => r.code === code)) continue;
      const w1 = caseWeight(l0.findings, code);
      const w0 = caseWeight(beforeL0.findings, code);
      // "Fixed one thing, broke another": a Major/Critical finding of a rule the case was NOT flagged for
      // before is a regression even when the total weight nets out (one Major traded for another).
      const rulesBefore = new Set(caseFindings(beforeL0.findings, code).map((f) => f.rule));
      const introduced = caseFindings(l0.findings, code).find((f) => f.severity !== 'Minor' && !rulesBefore.has(f.rule));
      if (w1 > w0) {
        revert(code, `code checks got worse after the revision (weight ${w0} -> ${w1})`);
        changed = true;
      } else if (introduced) {
        revert(code, `the revision introduced a new ${introduced.rule} ${introduced.severity} defect: ${introduced.issue}`);
        changed = true;
      }
    }
    for (const code of input.new_codes) {
      if (rejectedNew.some((r) => r.code === code)) continue;
      const bad = l0.findings.find(
        (f) => f.kind !== 'question' && f.scope === 'case' && f.test_case_codes.includes(code) && f.severity !== 'Minor' && getRule(f.rule)?.component === 'depth',
      );
      if (bad) {
        current = current.filter((c) => c.code !== code);
        rejectedNew.push({ code, reason: `new case violates ${bad.rule}: ${bad.issue}` });
        reasons.set(code, `new case violates ${bad.rule}`);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // 2) Atom coverage may not go down.
  const covBefore = beforeL0.coverage?.covered_atoms ?? 0;
  let covNow = computeDocumentCoverage(input.l0.documents, current)?.covered_atoms ?? 0;
  while (covNow < covBefore) {
    let best: { code: string; cov: number } | null = null;
    for (const code of input.patched_codes) {
      if (rolled.some((r) => r.code === code)) continue;
      const original = origByCode.get(code);
      if (!original) continue;
      const trial = current.map((c) => (c.code === code ? original : c));
      const cov = computeDocumentCoverage(input.l0.documents, trial)?.covered_atoms ?? 0;
      if (cov > covNow && (!best || cov > best.cov)) best = { code, cov };
    }
    if (!best) break;
    revert(best.code, 'the revision reduced document atom coverage');
    covNow = best.cov;
  }

  const afterL0 = runL0(current, input.l0);
  const beforeFp = new Set(beforeL0.findings.map((f) => f.fingerprint));
  const afterFp = new Set(afterL0.findings.map((f) => f.fingerprint));
  return {
    test_cases: current,
    rolled_back: rolled,
    rejected_new: rejectedNew,
    rollback_reason: reasons,
    delta: {
      mechanical_before: tally(beforeL0.findings),
      mechanical_after: tally(afterL0.findings),
      mechanical_resolved: [...beforeFp].filter((fp) => !afterFp.has(fp)).length,
      mechanical_introduced: [...afterFp].filter((fp) => !beforeFp.has(fp)).length,
      cases_flagged_before: flaggedCases(beforeL0.findings),
      cases_flagged_after: flaggedCases(afterL0.findings),
      atom_coverage_before: beforeL0.coverage ? beforeL0.coverage.coverage_percent : null,
      atom_coverage_after: afterL0.coverage ? afterL0.coverage.coverage_percent : null,
      score_before: computeScore({
        findings: [...beforeL0.findings, ...input.semantic_before],
        total_cases: input.before.length,
        atom_coverage_percent: beforeL0.coverage ? beforeL0.coverage.coverage_percent : null,
        mode: beforeL0.prepared.mode,
      }).score,
      verdict_before: computeScore({
        findings: [...beforeL0.findings, ...input.semantic_before],
        total_cases: input.before.length,
        atom_coverage_percent: beforeL0.coverage ? beforeL0.coverage.coverage_percent : null,
        mode: beforeL0.prepared.mode,
      }).verdict,
      score_is_estimate: true,
      l0_after: afterL0,
    },
  };
}

/** Score/verdict after the run, with semantic findings counted as resolved only when an application-verified change exists. */
export function estimateScoreAfter(input: {
  after_l0: ReturnType<typeof runL0>;
  semantic_before: readonly ReviewFinding[];
  resolutions: readonly FinalResolution[];
  total_cases: number;
}): { score: number; verdict: string } {
  const resolved = new Set(
    input.resolutions.filter((r) => r.status === 'FIXED' || r.status === 'ADDED' || r.status === 'SPLIT' || r.status === 'REMOVED').map((r) => r.fingerprint),
  );
  const remaining = input.semantic_before.filter((f) => !resolved.has(f.fingerprint));
  const s = computeScore({
    findings: [...input.after_l0.findings, ...remaining],
    total_cases: input.total_cases,
    atom_coverage_percent: input.after_l0.coverage ? input.after_l0.coverage.coverage_percent : null,
    mode: input.after_l0.prepared.mode,
  });
  return { score: s.score, verdict: s.verdict };
}
