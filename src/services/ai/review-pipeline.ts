// ============================================================================
// File: src/services/ai/review-pipeline.ts
// Glue between the three layers of Review:
//   prepareReview()   L0  facts + mechanical findings + grounding (before the model call)
//   finalizeReviewV2() L1->L2  clamp the model's findings, merge with L0, compute score/verdict,
//                              build the legacy-compatible ReviewResult
// Pure: no env, no clock, no I/O.
// ============================================================================

import type { GeneratedTestCase, GenerationAnalysis, ReviewModelOutput, ReviewResult, TestCaseCategory } from '@/models/validators/test-case';
import type { ParsedDocument } from '@/models/validators/document';
import { collectAtomInventory, type DocumentCoverageResult } from '@/services/documents/coverage';
import { REVIEW_LIMITS, type ReviewMode } from './quality-standards';
import { analyzeTestCases, finalizeReview, type DeterministicAnalysis } from './review-analysis';
import { computeDocumentCoverage } from '@/services/documents/coverage';
import {
  assignIds,
  clampSemanticFindings,
  clip,
  compareRuns,
  computeScore,
  isWaived,
  ruleForLegacyArea,
  toLegacyIssues,
  type ClampContext,
  type RawFinding,
  type ReviewFinding,
  type Waiver,
} from './review-findings';
import {
  buildGroundingPack,
  buildSourceText,
  computeMechanical,
  determineReviewMode,
  type GroundingPack,
  type ReviewFacts,
} from './review-facts';
import { selectCasesForReview } from './prompts/review-agent';

export type PreparedReview = {
  mode: ReviewMode;
  facts: ReviewFacts;
  mechanical: RawFinding[];
  waived_mechanical: number;
  grounding: GroundingPack;
  source_text: string;
  atom_ids: Set<string>;
  shown_codes: Set<string>;
};

export function prepareReview(input: {
  test_cases: GeneratedTestCase[];
  requirement_description: string;
  documents: ParsedDocument[];
  language: string;
  detail_level: string;
  required_categories: readonly TestCaseCategory[];
  per_category_min: number;
  analysis: DeterministicAnalysis;
  coverage: DocumentCoverageResult | null;
  generation_analysis?: GenerationAnalysis | null;
  waivers?: readonly Waiver[];
  non_string_test_data_codes?: readonly string[];
}): PreparedReview {
  const { mode } = determineReviewMode(input.requirement_description, input.documents);
  const { findings, facts } = computeMechanical({ ...input, mode });
  const waivers = input.waivers ?? [];
  const live = findings.filter((f) => !isWaived(f, waivers));

  const flagged = new Set<string>();
  for (const f of live) f.test_case_codes.forEach((c) => flagged.add(c));
  const shown = selectCasesForReview(
    input.test_cases,
    input.analysis,
    input.required_categories,
    input.per_category_min,
    REVIEW_LIMITS.maxCasesInPrompt,
    [...flagged],
  );
  return {
    mode,
    facts: { ...facts, flagged_codes: [...flagged] },
    mechanical: live,
    waived_mechanical: findings.length - live.length,
    grounding: buildGroundingPack({ shown, documents: input.documents, generation_analysis: input.generation_analysis }),
    source_text: buildSourceText(input.requirement_description, input.documents),
    atom_ids: new Set(collectAtomInventory(input.documents).ordered.map((a) => a.atom_id)),
    shown_codes: new Set(shown.map((tc) => tc.code)),
  };
}

// ── Generator feedback (§8): rule histogram -> symptom -> cause -> lever ───

const LEVERS: Record<string, string> = {
  Q02: 'cases below the step minimum -> generator emits merged/1-step cases -> reject them in validateGeneratedTestCases (min steps) and regenerate only those cases',
  Q03: 'generic actions -> no concrete-target check at acceptance -> run the vague-lexicon check on actions inside generation validation',
  Q04: 'placeholder or inconsistent test data -> nothing validates data at acceptance -> run lintTestData before accepting generation output',
  Q05: 'cases without preconditions -> field is optional in practice -> require at least one precondition in the generation schema validation',
  Q06: 'unobservable expected results -> vague wording accepted -> reject lexicon hits in expected_result at acceptance',
  Q07: 'unmeasurable final results -> same cause as Q06 -> apply the lexicon check to final_expected_result',
  Q11: 'wrong priorities -> priority is free-form per case -> derive priority from the persisted risk_ranking deterministically',
  Q12: 'cases without atom ids -> mapping rule is prompt-only -> reject empty source_requirement_ids when atoms exist',
  Q15: 'atom laundering (cited but not exercised) -> coverage is maximised by citation -> check assessMappingEvidence per citation in code and drop weak ones',
  Q20: 'category shortfall -> per-category minimum is not enforced after generation -> top up missing categories in code before returning',
  Q25: 'duplicates -> batches see only an index of earlier scenarios -> de-duplicate against the full suite (signature + Jaccard) after every batch',
  Q26: 'uncovered atoms -> coverage repair is best-effort -> re-run repair until coverage is complete or budget ends',
  Q27: 'shallow atom coverage (NOT NULL/UNIQUE/FK/branches) -> obligations are prompt-only -> generate obligation cases from atom_type in code',
};

export function buildRuleHistogram(findings: readonly ReviewFinding[], totalCases: number) {
  const byRule = new Map<string, { count: number; cases: Set<string> }>();
  for (const f of findings) {
    if (f.kind === 'question') continue;
    const e = byRule.get(f.rule) ?? { count: 0, cases: new Set<string>() };
    e.count++;
    f.test_case_codes.forEach((c) => e.cases.add(c));
    byRule.set(f.rule, e);
  }
  return [...byRule.entries()]
    .map(([rule, e]) => ({
      rule,
      findings: e.count,
      cases: e.cases.size,
      percent_of_cases: Math.round((e.cases.size / Math.max(1, totalCases)) * 100),
    }))
    .sort((a, b) => b.cases - a.cases || b.findings - a.findings || a.rule.localeCompare(b.rule));
}

export function buildGeneratorRecommendations(histogram: ReturnType<typeof buildRuleHistogram>): string[] {
  return histogram
    .filter((h) => LEVERS[h.rule])
    .slice(0, 3)
    .map((h) => clip(`${h.rule} (${h.findings} finding(s), ${h.percent_of_cases}% of cases): ${LEVERS[h.rule]}`, 260));
}

// ── Finalize ───────────────────────────────────────────────────────────────

export type FinalizeV2Input = {
  model_output: ReviewModelOutput | null;
  analysis: DeterministicAnalysis;
  test_cases: GeneratedTestCase[];
  prepared: PreparedReview;
  required_categories: readonly TestCaseCategory[];
  coverage: DocumentCoverageResult | null;
  waivers?: readonly Waiver[];
  previous_run?: { fingerprints: readonly string[]; resolved_fingerprints?: readonly string[] };
  prompt_version: string;
};

/** Legacy `issues[]` from a model that ignored the new schema -> low-confidence findings. */
function legacyIssuesToFindings(model: ReviewModelOutput): Partial<RawFinding>[] {
  return model.issues.map((i) => {
    const hasCode = Boolean(i.test_case_code?.trim());
    const taxonomy = i.area === 'taxonomy';
    return {
      rule: ruleForLegacyArea(i.area),
      kind: hasCode ? 'defect' : 'question',
      severity: i.severity,
      confidence: 'Low',
      action: taxonomy ? 'RECLASSIFY' : 'FIX',
      scope: hasCode ? 'case' : 'suite',
      test_case_codes: hasCode ? [i.test_case_code!.trim()] : [],
      fields_affected: taxonomy ? ['category'] : ['steps'],
      issue: i.description,
      evidence: i.evidence,
      enhance_instruction: `Resolve: ${i.description}`,
    } as Partial<RawFinding>;
  });
}

export function finalizeReviewV2(input: FinalizeV2Input): ReviewResult {
  const { prepared } = input;
  const total = input.test_cases.length;
  const model = input.model_output;
  const waivers = input.waivers ?? [];

  const ctx: ClampContext = {
    knownCodes: new Set(input.test_cases.map((tc) => tc.code)),
    shownCodes: prepared.shown_codes,
    mode: prepared.mode,
    sourceText: prepared.source_text,
    atomIds: prepared.atom_ids,
    categories: new Set<string>(input.required_categories),
    waivers,
  };

  const candidates: Partial<RawFinding>[] = [...(model?.findings ?? []), ...(model ? legacyIssuesToFindings(model) : [])];
  const { kept, dropped } = clampSemanticFindings(candidates, ctx);

  // A semantic FIX that only repeats a mechanical finding of the same rule on the same cases adds nothing.
  const semantic = kept.filter((s) => {
    if (s.action !== 'FIX') return true;
    const covered = prepared.mechanical.some(
      (m) => m.rule === s.rule && s.test_case_codes.length > 0 && s.test_case_codes.every((c) => m.test_case_codes.includes(c)),
    );
    if (covered) dropped.push({ reason: 'duplicates_mechanical', rule: s.rule });
    return !covered;
  });

  const findings = assignIds([
    ...prepared.mechanical.map((f) => ({ finding: f, origin: 'mechanical' as const })),
    ...semantic.map((f) => ({ finding: f, origin: 'semantic' as const })),
  ]).slice(0, REVIEW_LIMITS.maxTotalFindings);

  // The existing finalizer keeps owning taxonomy ceilings, language_detail and the structure errors.
  const legacy = finalizeReview({
    model_output: model ? { ...model, issues: [] } : null,
    analysis: input.analysis,
    test_cases: input.test_cases,
  });

  const score = computeScore({
    findings,
    total_cases: total,
    atom_coverage_percent: input.coverage ? input.coverage.coverage_percent : null,
    mode: prepared.mode,
  });

  const scored = findings.filter((f) => f.kind !== 'question');
  const sev = { Critical: 0, Major: 0, Minor: 0 };
  for (const f of scored) sev[f.severity]++;

  // overall_status keeps its legacy meaning; code findings can only make it stricter.
  let overall_status = legacy.overall_status;
  if (overall_status === 'PASS' && scored.length > 0) overall_status = 'NEEDS_IMPROVEMENT';
  if (score.verdict === 'REJECT / REGENERATE') overall_status = 'FAIL';

  const flagged = new Set<string>();
  for (const f of scored) f.test_case_codes.forEach((c) => flagged.add(c));
  const clean = total - flagged.size;

  const strengths = [
    ...(model?.strengths ?? []).map((s) => clip(s, REVIEW_LIMITS.maxStrengthChars)).filter(Boolean).slice(0, REVIEW_LIMITS.maxStrengths),
    ...(clean > 0 ? [`${clean}/${total} cases have no finding from the code checks`] : []),
  ];

  const questions = [
    ...(model?.open_questions ?? []).map((q) => clip(q, REVIEW_LIMITS.maxOpenQuestionChars)).filter(Boolean).slice(0, REVIEW_LIMITS.maxOpenQuestions),
    ...findings.filter((f) => f.kind === 'question').map((f) => clip(f.issue, REVIEW_LIMITS.maxOpenQuestionChars)),
  ].slice(0, REVIEW_LIMITS.maxOpenQuestions + 3);

  const histogram = buildRuleHistogram(findings, total);
  const generatorRecs = buildGeneratorRecommendations(histogram);

  const dropCounts: Record<string, number> = {};
  for (const d of dropped) dropCounts[d.reason.split(':')[0]] = (dropCounts[d.reason.split(':')[0]] ?? 0) + 1;

  const summary = [
    legacy.summary,
    `${scored.length} finding(s): ${sev.Critical} Critical, ${sev.Major} Major, ${sev.Minor} Minor`,
    `score ${score.score}/100${score.provisional ? ' (provisional)' : ''} → ${score.verdict}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return {
    ...legacy,
    overall_status,
    summary,
    // Legacy `issues`: model-owned findings only (mechanical ones live in `findings`).
    issues: toLegacyIssues(findings.filter((f) => f.origin === 'semantic')),
    recommendations: [...legacy.recommendations, ...generatorRecs].slice(0, REVIEW_LIMITS.maxRecommendations + 3),
    findings,
    strengths,
    open_questions: questions,
    review_mode: prepared.mode,
    score,
    prompt_version: input.prompt_version,
    ...(input.previous_run ? { comparison: compareRuns(findings, input.previous_run) } : {}),
    coverage_basis: {
      cases_shown: prepared.shown_codes.size,
      cases_total: total,
      waived: prepared.waived_mechanical + dropped.filter((d) => d.reason === 'waived').length,
      dropped: dropCounts,
    },
    rule_histogram: histogram,
    generator_recommendations: generatorRecs,
  };
}

// ── Re-runnable L0 (Review prep AND Enhance verification share it) ─────────

export type L0Context = {
  requirement_description: string;
  documents: ParsedDocument[];
  language: string;
  detail_level: string;
  required_categories: readonly TestCaseCategory[];
  per_category_min: number;
  generation_analysis?: GenerationAnalysis | null;
};

/**
 * The whole deterministic layer on an arbitrary suite: analysis, coverage, mechanical findings
 * (ids assigned). Enhance calls it before and after a merge so the before/after delta is
 * computed by the SAME code that produced the findings.
 */
export function runL0(cases: GeneratedTestCase[], ctx: L0Context) {
  const analysis = analyzeTestCases({
    test_cases: cases,
    detail_level: ctx.detail_level,
    required_categories: ctx.required_categories,
    per_category_min: ctx.per_category_min,
    documents: ctx.documents,
    language: ctx.language,
  });
  const coverage = computeDocumentCoverage(ctx.documents, cases);
  const prepared = prepareReview({ ...ctx, test_cases: cases, analysis, coverage });
  const findings = assignIds(prepared.mechanical.map((finding) => ({ finding, origin: 'mechanical' as const })));
  return { analysis, coverage, prepared, findings };
}
