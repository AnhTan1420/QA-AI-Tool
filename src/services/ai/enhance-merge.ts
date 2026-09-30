// ============================================================================
// File: src/services/ai/enhance-merge.ts
// The DETERMINISTIC halves of Enhance.
//
//   Review findings + current suite
//        -> planEnhancement()   picks a FOCUSED set of target cases (bounded)
//        -> Enhance model       returns revised/new cases only
//        -> applyEnhancement()  enforces what Enhance is allowed to change
//        -> validation          (route: normalize + validateGeneratedTestCases)
//
// The Enhance prompt says "preserve valid behaviour, don't add unrelated
// scenarios". This file makes that true regardless of what the model returns.
// ============================================================================

import type { GeneratedTestCase, ReviewResult, TestCaseCategory } from '@/models/validators/test-case';
import { TestCaseCodeAllocator } from '@/services/ai/test-case-validation';
import { ENHANCE_LIMITS } from '@/services/ai/quality-standards';
import { truncate, type DeterministicAnalysis } from '@/services/ai/review-analysis';

export type TaxonomyGap = {
  category: TestCaseCategory;
  status: 'MISSING' | 'PARTIALLY_SUPPORTED';
  evidence: string;
  existing_codes: string[];
  /** Upper bound on NEW cases Enhance may add for this category. */
  allowed_new: number;
};

export type EnhancePlan = {
  targets: GeneratedTestCase[];
  /** Short, structured findings per target case (from rules AND Review). */
  findings: Map<string, string[]>;
  /** Cases with findings that did not fit the per-pass cap. */
  deferred_codes: string[];
  taxonomy_gaps: TaxonomyGap[];
};

const SEVERITY_RANK = { Critical: 0, Major: 1, Minor: 3 } as const;

export function planEnhancement(input: {
  test_cases: GeneratedTestCase[];
  analysis: DeterministicAnalysis;
  review: ReviewResult | null | undefined;
}): EnhancePlan {
  const known = new Map(input.test_cases.map((tc) => [tc.code, tc]));
  const findings = new Map<string, string[]>();
  const rank = new Map<string, number>();

  const note = (code: string, text: string, r: number) => {
    if (!known.has(code) || !text.trim()) return;
    const list = findings.get(code) ?? [];
    const clipped = truncate(text, ENHANCE_LIMITS.maxChangeSummaryChars);
    if (!list.includes(clipped)) list.push(clipped);
    findings.set(code, list);
    rank.set(code, Math.min(rank.get(code) ?? 99, r));
  };

  // Rules recomputed here — never trust a client-supplied review for facts.
  for (const assessed of input.analysis.cases) {
    if (assessed.status === 'APPROPRIATE') continue;
    const r = assessed.status === 'TOO_VAGUE' ? 0 : 2;
    note(assessed.test_case_code, `${assessed.status}: ${assessed.reasons.map((x) => x.message).join(' ')}`, r);
  }

  // Review's semantic findings.
  for (const item of input.review?.language_detail.issues ?? []) {
    note(item.test_case_code, `${item.status}: ${item.reason}`, item.status === 'TOO_VAGUE' ? 0 : 2);
  }
  for (const issue of input.review?.issues ?? []) {
    if (issue.test_case_code) note(issue.test_case_code, `${issue.area}: ${issue.description}`, SEVERITY_RANK[issue.severity]);
  }

  const ordered = [...findings.keys()].sort((a, b) => (rank.get(a) ?? 99) - (rank.get(b) ?? 99));
  const selected = ordered.slice(0, ENHANCE_LIMITS.maxTargetCases);
  const selectedSet = new Set(selected);

  // Taxonomy gaps: rule-proven (count below the requirement) or Review-judged.
  // INSUFFICIENT_EVIDENCE is deliberately NOT a gap — that would be inventing one.
  const reviewByCategory = new Map((input.review?.taxonomy ?? []).map((t) => [t.category, t]));
  const taxonomy_gaps: TaxonomyGap[] = [];
  for (const base of input.analysis.taxonomy) {
    const judged = reviewByCategory.get(base.category);
    const judgedGap = judged?.status === 'MISSING' || judged?.status === 'PARTIALLY_SUPPORTED';
    if (base.ceiling === 'SUPPORTED' && !judgedGap) continue;

    const shortfall = Math.max(0, base.required_min - base.case_count);
    taxonomy_gaps.push({
      category: base.category,
      status: base.ceiling === 'MISSING' || judged?.status === 'MISSING' ? 'MISSING' : 'PARTIALLY_SUPPORTED',
      evidence: truncate(judged?.evidence || `${base.case_count} of ${base.required_min} required case(s).`, ENHANCE_LIMITS.maxChangeSummaryChars),
      existing_codes: base.codes.slice(0, 5),
      allowed_new: Math.min(ENHANCE_LIMITS.maxNewCasesPerCategory, Math.max(1, shortfall)),
    });
  }

  return {
    targets: selected.map((code) => known.get(code)!),
    findings,
    deferred_codes: ordered.filter((code) => !selectedSet.has(code)),
    taxonomy_gaps,
  };
}

export function isNoOpPlan(plan: EnhancePlan): boolean {
  return plan.targets.length === 0 && plan.taxonomy_gaps.length === 0;
}

// ── Guarded merge ──────────────────────────────────────────────────────────

export type RejectedChange = { code: string; reason: string };

export type ApplyResult = {
  test_cases: GeneratedTestCase[];
  revised_codes: string[];
  added_codes: string[];
  rejected: RejectedChange[];
};

/**
 * Merge the model's returned cases into the existing suite under hard rules:
 *
 *   • A returned case whose code is an existing TARGET  -> revision. Its
 *     category, priority and source_requirement_ids are restored from the
 *     original (Enhance improves quality; it does not change what a case is,
 *     how important it is, or which document atoms it claims). test_data and
 *     preconditions the model omitted are restored too.
 *   • A returned case whose code is an existing NON-target -> rejected
 *     (unrequested change to a case Review had no finding on).
 *   • A returned case with a NEW code -> accepted only if its category is a
 *     proven taxonomy gap and that gap's allowed_new budget is not exhausted.
 *     Anything else is an "unrelated scenario" and is dropped.
 *   • Every existing case the model did not return is kept byte-for-byte.
 */
export function applyEnhancement(
  existing: GeneratedTestCase[],
  returned: GeneratedTestCase[],
  plan: EnhancePlan,
): ApplyResult {
  const byCode = new Map(existing.map((tc) => [tc.code, tc]));
  const targetCodes = new Set(plan.targets.map((tc) => tc.code));
  const budget = new Map(plan.taxonomy_gaps.map((gap) => [gap.category, gap.allowed_new]));

  const revisions = new Map<string, GeneratedTestCase>();
  const additions: GeneratedTestCase[] = [];
  const rejected: RejectedChange[] = [];
  const allocator = new TestCaseCodeAllocator(existing);

  for (const candidate of returned) {
    const original = byCode.get(candidate.code);

    if (original) {
      if (!targetCodes.has(candidate.code)) {
        rejected.push({ code: candidate.code, reason: 'not_a_target: Review had no finding on this case' });
        continue;
      }
      if (revisions.has(candidate.code)) {
        rejected.push({ code: candidate.code, reason: 'duplicate_revision' });
        continue;
      }
      revisions.set(candidate.code, {
        ...candidate,
        category: original.category,
        priority: original.priority,
        preconditions: candidate.preconditions?.length ? candidate.preconditions : original.preconditions,
        test_data: candidate.test_data && Object.keys(candidate.test_data).length > 0 ? candidate.test_data : original.test_data,
        steps: candidate.steps.map((step, i) => ({ ...step, step_number: i + 1 })),
        ...(original.source_requirement_ids ? { source_requirement_ids: original.source_requirement_ids } : {}),
      });
      continue;
    }

    const remaining = budget.get(candidate.category) ?? 0;
    if (remaining <= 0) {
      rejected.push({
        code: candidate.code,
        reason: budget.has(candidate.category)
          ? `new_case_over_budget: category "${candidate.category}" already received its allowed new cases`
          : `unrelated_scenario: category "${candidate.category}" is not an unsupported required category`,
      });
      continue;
    }
    budget.set(candidate.category, remaining - 1);
    additions.push({
      ...candidate,
      code: allocator.allocate(candidate.code),
      steps: candidate.steps.map((step, i) => ({ ...step, step_number: i + 1 })),
    });
  }

  return {
    test_cases: [...existing.map((tc) => revisions.get(tc.code) ?? tc), ...additions],
    revised_codes: [...revisions.keys()],
    added_codes: additions.map((tc) => tc.code),
    rejected,
  };
}
