// ============================================================================
// File: src/services/ai/review-analysis.ts
// The DETERMINISTIC halves of Review.
//
//   Generate -> analyzeTestCases()   (rules, counts, structure — no AI)
//            -> Review AI            (semantic judgment only)
//            -> finalizeReview()     (clamp, filter, merge, compute status — no AI)
//
// Anything measurable is decided here, not by the model: step counts, length,
// placeholder wording, per-category case counts, structural validity, and the
// overall PASS / NEEDS_IMPROVEMENT / FAIL status. The model is only asked what
// code cannot know (does this case genuinely exercise its category? is this
// action concrete enough to execute?). It can make a finding WORSE than the
// rules say, never better.
// ============================================================================

import type {
  GeneratedTestCase,
  ReviewModelOutput,
  ReviewResult,
  TestCaseCategory,
} from '@/models/validators/test-case';
import type { ParsedDocument } from '@/models/validators/document';
import { validateGeneratedTestCases } from '@/services/ai/test-case-validation';
import {
  QUALITY_RULES,
  REVIEW_LIMITS,
  findLexiconVague,
  getDetailLevelRules,
  isPlaceholder,
  isVaguePhrase,
  type DetailStatus,
  type RuleId,
  type TaxonomyStatus,
} from '@/services/ai/quality-standards';

// ── Deterministic analysis ─────────────────────────────────────────────────

export type DetailReasonCode =
  | 'too_few_steps'
  | 'placeholder_step'
  | 'vague_wording'
  | 'vague_final_result'
  | 'too_many_steps'
  | 'overlong_text'
  | 'repeated_steps';

export type CaseDetailReason = {
  code: DetailReasonCode;
  message: string;
  /** Rule of the shared catalog (quality-standards RULE_CATALOG) this reason belongs to. */
  rule?: RuleId;
  /** 1-based step numbers the reason is about (when it is about steps). */
  steps?: number[];
  /** Case fields Enhance may change to resolve it. */
  fields?: ('steps' | 'final_expected_result')[];
};

export type CaseDetailAssessment = {
  test_case_code: string;
  status: DetailStatus;
  reasons: CaseDetailReason[];
};

export type TaxonomyBaseline = {
  category: TestCaseCategory;
  case_count: number;
  required_min: number;
  /** Highest status the application will allow for this category. */
  ceiling: 'SUPPORTED' | 'PARTIALLY_SUPPORTED' | 'MISSING';
  codes: string[];
};

export type DeterministicAnalysis = {
  cases: CaseDetailAssessment[];
  counts: Record<DetailStatus, number>;
  taxonomy: TaxonomyBaseline[];
  structure_errors: string[];
};

const VAGUE_CODES: ReadonlySet<DetailReasonCode> = new Set([
  'too_few_steps',
  'placeholder_step',
  'vague_wording',
  'vague_final_result',
]);

export function assessCaseDetail(
  testCase: GeneratedTestCase,
  detailLevel: string | undefined,
  /** input.language: selects the vague-wording lexicon (Vietnamese + English, or English). */
  language?: string,
): CaseDetailAssessment {
  const rules = getDetailLevelRules(detailLevel);
  const reasons: CaseDetailAssessment['reasons'] = [];
  const steps = testCase.steps ?? [];

  if (steps.length < rules.minSteps) {
    reasons.push({
      code: 'too_few_steps',
      message: `${steps.length} step(s); the standard requires at least ${rules.minSteps}.`,
      rule: 'Q02',
      fields: ['steps'],
    });
  }
  if (steps.length > rules.maxSteps) {
    reasons.push({
      code: 'too_many_steps',
      message: `${steps.length} steps; the standard allows at most ${rules.maxSteps}.`,
      rule: 'Q02',
      fields: ['steps'],
    });
  }

  const placeholderSteps: number[] = [];
  const vagueActionSteps: number[] = [];
  const vagueExpectedSteps: number[] = [];
  const overlongSteps: number[] = [];
  const seenActions = new Map<string, number>();
  let repeated = 0;

  steps.forEach((step, index) => {
    const n = index + 1;
    const action = step.action ?? '';
    const expected = step.expected_result ?? '';
    if (isPlaceholder(action) || isPlaceholder(expected)) placeholderSteps.push(n);
    else {
      if (isVaguePhrase(action) || findLexiconVague(action, language)) vagueActionSteps.push(n);
      if (isVaguePhrase(expected) || findLexiconVague(expected, language)) vagueExpectedSteps.push(n);
    }
    if (action.length > QUALITY_RULES.maxActionChars || expected.length > QUALITY_RULES.maxExpectedChars) {
      overlongSteps.push(n);
    }
    const key = action.trim().toLowerCase().replace(/\s+/g, ' ');
    if (key.length >= 4) {
      const seen = (seenActions.get(key) ?? 0) + 1;
      seenActions.set(key, seen);
      if (seen === 2) repeated++;
    }
  });

  if (placeholderSteps.length > 0) {
    reasons.push({
      code: 'placeholder_step',
      message: `Placeholder/empty action or expected result at step(s) ${placeholderSteps.join(', ')}.`,
      rule: 'Q06',
      steps: placeholderSteps,
      fields: ['steps'],
    });
  }
  if (vagueActionSteps.length > 0) {
    reasons.push({
      code: 'vague_wording',
      message: `Generic wording in the action at step(s) ${vagueActionSteps.join(', ')}.`,
      rule: 'Q03',
      steps: vagueActionSteps,
      fields: ['steps'],
    });
  }
  if (vagueExpectedSteps.length > 0) {
    reasons.push({
      code: 'vague_wording',
      message: `Generic wording in the expected result at step(s) ${vagueExpectedSteps.join(', ')}.`,
      rule: 'Q06',
      steps: vagueExpectedSteps,
      fields: ['steps'],
    });
  }

  const finalResult = testCase.final_expected_result ?? '';
  if (
    isPlaceholder(finalResult) ||
    finalResult.trim().length < QUALITY_RULES.minFinalExpectedChars ||
    isVaguePhrase(finalResult) ||
    findLexiconVague(finalResult, language)
  ) {
    reasons.push({
      code: 'vague_final_result',
      message: 'final_expected_result does not state an observable end-state.',
      rule: 'Q07',
      fields: ['final_expected_result'],
    });
  }

  if (overlongSteps.length > 0 || finalResult.length > QUALITY_RULES.maxFinalExpectedChars) {
    reasons.push({
      code: 'overlong_text',
      message: 'Step or final result text is prose-length rather than a single assertion.',
      rule: 'Q02',
      steps: overlongSteps,
      fields: ['steps', 'final_expected_result'],
    });
  }
  if (repeated > 0) {
    reasons.push({
      code: 'repeated_steps',
      message: `${repeated} action(s) repeated verbatim within the case.`,
      rule: 'Q02',
      fields: ['steps'],
    });
  }

  const status: DetailStatus = reasons.some((r) => VAGUE_CODES.has(r.code))
    ? 'TOO_VAGUE'
    : reasons.length > 0
      ? 'OVER_DETAILED'
      : 'APPROPRIATE';

  return { test_case_code: testCase.code, status, reasons };
}

export function analyzeTestCases(input: {
  test_cases: GeneratedTestCase[];
  detail_level: string | undefined;
  /** input.language (selects the vague lexicon). Optional: omitted => English lexicon only. */
  language?: string;
  required_categories: readonly TestCaseCategory[];
  per_category_min: number;
  documents?: ParsedDocument[] | null;
}): DeterministicAnalysis {
  const cases = input.test_cases.map((tc) => assessCaseDetail(tc, input.detail_level, input.language));

  const counts: Record<DetailStatus, number> = { TOO_VAGUE: 0, APPROPRIATE: 0, OVER_DETAILED: 0 };
  for (const c of cases) counts[c.status]++;

  const taxonomy: TaxonomyBaseline[] = input.required_categories.map((category) => {
    const codes = input.test_cases.filter((tc) => tc.category === category).map((tc) => tc.code);
    const ceiling: TaxonomyBaseline['ceiling'] =
      codes.length === 0 ? 'MISSING' : codes.length < input.per_category_min ? 'PARTIALLY_SUPPORTED' : 'SUPPORTED';
    return { category, case_count: codes.length, required_min: input.per_category_min, ceiling, codes };
  });

  const structure = validateGeneratedTestCases(input.test_cases, { documents: input.documents });
  const structure_errors = structure.errors
    .slice(0, REVIEW_LIMITS.maxIssues)
    .map((issue) => truncate(issue.message, REVIEW_LIMITS.maxDescriptionChars));

  return { cases, counts, taxonomy, structure_errors };
}

// ── Helpers ────────────────────────────────────────────────────────────────

export function truncate(value: string | undefined | null, max: number): string {
  const text = (value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…` : text;
}

const SEVERITY_RANK: Record<'Critical' | 'Major' | 'Minor', number> = { Critical: 0, Major: 1, Minor: 2 };
const DETAIL_RANK: Record<DetailStatus, number> = { TOO_VAGUE: 0, OVER_DETAILED: 1, APPROPRIATE: 2 };

// ── Post-processing: merge, clamp, decide ──────────────────────────────────

export function finalizeReview(input: {
  model_output: ReviewModelOutput | null;
  analysis: DeterministicAnalysis;
  test_cases: GeneratedTestCase[];
}): ReviewResult {
  const { analysis } = input;
  const ai: ReviewModelOutput = input.model_output ?? {
    language_detail: [],
    taxonomy: [],
    issues: [],
    recommendations: [],
  };
  const knownCodes = new Set(input.test_cases.map((tc) => tc.code));

  // 1) LANGUAGE & DETAIL — rules are facts; the model can only add findings.
  type Merged = { test_case_code: string; status: DetailStatus; reason: string; source: 'rule' | 'ai' };
  const merged = new Map<string, Merged>();

  for (const assessed of analysis.cases) {
    if (assessed.status === 'APPROPRIATE') continue;
    merged.set(assessed.test_case_code, {
      test_case_code: assessed.test_case_code,
      status: assessed.status,
      reason: assessed.reasons.map((r) => r.message).join(' '),
      source: 'rule',
    });
  }
  for (const finding of ai.language_detail) {
    const code = finding.test_case_code.trim();
    if (!knownCodes.has(code) || finding.status === 'APPROPRIATE') continue;
    const reason = truncate(finding.reason, REVIEW_LIMITS.maxDescriptionChars);
    if (!reason) continue; // a finding with no reason is not evidence-backed
    const existing = merged.get(code);
    if (!existing) {
      merged.set(code, { test_case_code: code, status: finding.status, reason, source: 'ai' });
    } else if (DETAIL_RANK[finding.status] < DETAIL_RANK[existing.status]) {
      // Worse (more vague) than the rules found -> take it. Never the reverse.
      merged.set(code, { ...existing, status: finding.status, reason: `${existing.reason} ${reason}`.trim(), source: 'ai' });
    }
  }

  const counts: Record<DetailStatus, number> = { TOO_VAGUE: 0, OVER_DETAILED: 0, APPROPRIATE: 0 };
  for (const tc of input.test_cases) counts[merged.get(tc.code)?.status ?? 'APPROPRIATE']++;

  const detailIssues = [...merged.values()]
    .sort((a, b) => DETAIL_RANK[a.status] - DETAIL_RANK[b.status])
    .slice(0, REVIEW_LIMITS.maxLanguageDetailIssues)
    .map((m) => ({ ...m, reason: truncate(m.reason, REVIEW_LIMITS.maxDescriptionChars) }));

  // Suite-level status: TOO_VAGUE blocks execution, so it wins over OVER_DETAILED.
  const detailStatus: DetailStatus =
    counts.TOO_VAGUE > 0 ? 'TOO_VAGUE' : counts.OVER_DETAILED > 0 ? 'OVER_DETAILED' : 'APPROPRIATE';

  // 2) TAXONOMY — the application's count is a CEILING, the model can only confirm or downgrade.
  const aiByCategory = new Map(ai.taxonomy.map((t) => [t.category.trim(), t]));
  const taxonomy: ReviewResult['taxonomy'] = analysis.taxonomy.map((base) => {
    if (base.ceiling === 'MISSING') {
      return {
        category: base.category,
        status: 'MISSING',
        evidence: `No test case is labelled "${base.category}" (required: at least ${base.required_min}).`,
        supporting_codes: [],
      };
    }

    const judged = aiByCategory.get(base.category);
    const evidence = truncate(judged?.evidence, REVIEW_LIMITS.maxEvidenceChars);
    const supporting = (judged?.supporting_codes ?? [])
      .filter((code) => base.codes.includes(code))
      .slice(0, REVIEW_LIMITS.maxSupportingCodes);

    let status: TaxonomyStatus;
    if (!judged) {
      // No semantic confirmation -> SUPPORTED cannot be claimed from a count alone.
      status = base.ceiling === 'SUPPORTED' ? 'INSUFFICIENT_EVIDENCE' : 'PARTIALLY_SUPPORTED';
    } else if (judged.status === 'NOT_APPLICABLE') {
      // The category is REQUIRED by the generation config, so it is never "not applicable".
      status = 'INSUFFICIENT_EVIDENCE';
    } else if (judged.status === 'SUPPORTED' && base.ceiling === 'PARTIALLY_SUPPORTED') {
      status = 'PARTIALLY_SUPPORTED';
    } else if (judged.status === 'SUPPORTED' && !evidence) {
      status = 'INSUFFICIENT_EVIDENCE'; // "supported" without evidence is an assertion, not a finding
    } else {
      status = judged.status;
    }

    return {
      category: base.category,
      status,
      evidence:
        evidence ||
        (base.ceiling === 'PARTIALLY_SUPPORTED'
          ? `${base.case_count} of ${base.required_min} required case(s).`
          : 'No evidence returned for this category.'),
      supporting_codes: supporting,
    };
  });

  // 3) ISSUES — must reference a real case (if any) and carry evidence.
  const issues = ai.issues
    .map((issue) => ({
      test_case_code: issue.test_case_code?.trim() || undefined,
      severity: issue.severity,
      area: issue.area,
      description: truncate(issue.description, REVIEW_LIMITS.maxDescriptionChars),
      evidence: truncate(issue.evidence, REVIEW_LIMITS.maxEvidenceChars),
    }))
    .filter((issue) => issue.description && issue.evidence)
    .filter((issue) => !issue.test_case_code || knownCodes.has(issue.test_case_code))
    .sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
    .slice(0, REVIEW_LIMITS.maxIssues);

  const recommendations = ai.recommendations
    .map((r) => truncate(r, REVIEW_LIMITS.maxRecommendationChars))
    .filter(Boolean)
    .slice(0, REVIEW_LIMITS.maxRecommendations);

  // 4) OVERALL STATUS — computed, never model-asserted.
  const missing = taxonomy.filter((t) => t.status === 'MISSING');
  const notFullySupported = taxonomy.filter((t) => t.status !== 'SUPPORTED' && t.status !== 'NOT_APPLICABLE');
  const total = Math.max(1, input.test_cases.length);
  const overall_status: ReviewResult['overall_status'] =
    missing.length > 0 || issues.some((i) => i.severity === 'Critical') || counts.TOO_VAGUE / total >= 0.5
      ? 'FAIL'
      : issues.length === 0 &&
          notFullySupported.length === 0 &&
          counts.TOO_VAGUE === 0 &&
          counts.OVER_DETAILED === 0 &&
          analysis.structure_errors.length === 0
        ? 'PASS'
        : 'NEEDS_IMPROVEMENT';

  const summaryParts = [
    `${counts.TOO_VAGUE} too vague, ${counts.OVER_DETAILED} over-detailed, ${counts.APPROPRIATE} appropriate (of ${input.test_cases.length} cases)`,
    missing.length > 0 ? `missing categories: ${missing.map((t) => t.category).join(', ')}` : null,
    notFullySupported.length > missing.length
      ? `${notFullySupported.length - missing.length} categor${notFullySupported.length - missing.length === 1 ? 'y' : 'ies'} not fully supported`
      : null,
    issues.length > 0 ? `${issues.length} issue(s)` : null,
  ].filter(Boolean);

  return {
    overall_status,
    summary: summaryParts.join(' · '),
    language_detail: { status: detailStatus, counts, issues: detailIssues },
    taxonomy,
    issues,
    recommendations,
    ...(analysis.structure_errors.length > 0 ? { structure_errors: analysis.structure_errors } : {}),
  };
}
