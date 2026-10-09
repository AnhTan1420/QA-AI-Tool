/**
 * Review must evaluate against the SAME standard Generate uses, and everything
 * measurable must be decided by code (not by the model).
 */
import { describe, it, expect } from 'vitest';
import { buildGenerationPrompt } from '@/services/ai/prompts/generation-agent';
import { buildReviewPrompt } from '@/services/ai/prompts/review-agent';
import { buildEnhancePrompt } from '@/services/ai/prompts/enhance-agent';
import type { z } from 'zod';
import { CATEGORY_VALUES, reviewModelOutputSchema, type ReviewResult, type TestCaseCategory } from '@/models/validators/test-case';
import {
  DETAIL_LEVEL_RULES,
  TAXONOMY_DEFINITIONS,
  REVIEW_LIMITS,
  getRequiredCategories,
  isPlaceholder,
  resolvePerCategoryMin,
  type DetailLevel,
} from '@/services/ai/quality-standards';
import { isPlaceholder as validationIsPlaceholder } from '@/services/ai/test-case-validation';
import { analyzeTestCases, assessCaseDetail, finalizeReview } from '@/services/ai/review-analysis';
import { planEnhancement } from '@/services/ai/enhance-merge';
import { goodCase, vagueCase, REQUIREMENT } from '../helpers/review-fixtures';

const LEVELS: DetailLevel[] = ['concise', 'standard', 'detailed'];

/**
 * Builds a model output the way production does: through the lenient schema, so omitted
 * arrays (findings, strengths, open_questions, ...) take their defaults instead of every
 * fixture having to repeat them.
 */
const modelOutput = (raw: z.input<typeof reviewModelOutputSchema>) => reviewModelOutputSchema.parse(raw);

function analyze(
  cases = [goodCase('TC_A_001')],
  level: DetailLevel = 'standard',
  required: readonly TestCaseCategory[] = ['positive', 'negative', 'boundary'],
) {
  const perMin = resolvePerCategoryMin(level, required.length);
  return { perMin, analysis: analyzeTestCases({ test_cases: cases, detail_level: level, required_categories: required, per_category_min: perMin }) };
}

describe('shared generation standards (Generate == Review)', () => {
  it('every category Generate validates has a taxonomy definition, and only those', () => {
    expect(Object.keys(TAXONOMY_DEFINITIONS).sort()).toEqual([...CATEGORY_VALUES].sort());
  });

  it.each(LEVELS)('Generate and Review state the SAME step bounds and per-category minimum (%s)', (level) => {
    const rules = DETAIL_LEVEL_RULES[level];
    const cats = ['positive', 'negative', 'boundary'] as const;

    const generation = buildGenerationPrompt({
      requirement_description: REQUIREMENT,
      retrieved_old_test_cases: [],
      selected_categories: [...cats],
      language: 'Tiếng Việt',
      detail_level: level,
      document_context: [],
    });
    expect(generation).toContain(`MINIMUM ${rules.minSteps} and MAXIMUM ${rules.maxSteps} steps`);
    const generationMin = Number(generation.match(/AT LEAST (\d+) distinct, non-overlapping cases/)?.[1]);

    const { analysis, perMin } = analyze([goodCase('TC_A_001')], level, cats);
    const review = buildReviewPrompt({
      requirement_description: REQUIREMENT,
      test_cases: [goodCase('TC_A_001')],
      detail_level: level,
      required_categories: cats,
      per_category_min: perMin,
      analysis,
      document_coverage: null,
    });
    expect(review).toContain(`at least ${rules.minSteps}, at most ${rules.maxSteps}`);
    const reviewMin = Number(review.match(/needing at least (\d+) distinct case/)?.[1]);

    expect(reviewMin).toBe(generationMin);
    // Enhance embeds the identical block.
    const enhance = buildEnhancePrompt({
      requirement_description: REQUIREMENT,
      detail_level: level,
      required_categories: cats,
      per_category_min: perMin,
      plan: { targets: [], findings: new Map(), deferred_codes: [], taxonomy_gaps: [] },
      suite_index: [],
      documents: [],
    });
    expect(enhance).toContain(`at least ${rules.minSteps}, at most ${rules.maxSteps}`);
  });

  it('the category floor cap lowers the minimum identically for Generate and Review', () => {
    const cats = ['positive', 'negative', 'boundary', 'security', 'localization', 'ui_ux', 'performance', 'integration'] as const;
    const floorCap = 7;
    const generation = buildGenerationPrompt({
      requirement_description: REQUIREMENT,
      retrieved_old_test_cases: [],
      selected_categories: [...cats],
      language: 'Tiếng Việt',
      detail_level: 'detailed',
      document_context: [],
      category_floor_cap: floorCap,
    });
    const generationMin = Number(generation.match(/AT LEAST (\d+) distinct, non-overlapping cases/)?.[1]);
    expect(resolvePerCategoryMin('detailed', cats.length, floorCap)).toBe(generationMin);
  });

  it('placeholder detection is one shared definition', () => {
    expect(validationIsPlaceholder).toBe(isPlaceholder);
  });

  it('falls back to the same default required categories Generate uses', () => {
    expect(getRequiredCategories(undefined)).toEqual(['positive', 'negative', 'boundary']);
    expect(getRequiredCategories([])).toEqual(['positive', 'negative', 'boundary']);
    expect(getRequiredCategories(['security', 'security'])).toEqual(['security']);
  });
});

describe('Language & Detail Level (deterministic)', () => {
  it('APPROPRIATE for a case that meets the standard', () => {
    expect(assessCaseDetail(goodCase('TC_A_001'), 'standard').status).toBe('APPROPRIATE');
  });

  it('TOO_VAGUE for generic wording, too few steps and an empty end-state', () => {
    const result = assessCaseDetail(vagueCase('TC_V_001'), 'standard');
    expect(result.status).toBe('TOO_VAGUE');
    expect(result.reasons.map((r) => r.code)).toEqual(
      expect.arrayContaining(['too_few_steps', 'placeholder_step', 'vague_final_result']),
    );
  });

  it('OVER_DETAILED for too many steps / prose-length text — a longer case is not better', () => {
    const bloated = goodCase('TC_O_001');
    bloated.steps = Array.from({ length: 14 }, (_, i) => ({
      step_number: i + 1,
      action: `Bấm nút 'Tiếp tục' lần ${i + 1} ở màn hình 'Đăng nhập'`,
      expected_result: 'Hệ thống phản hồi trong 1 giây với mã HTTP 200',
    }));
    expect(assessCaseDetail(bloated, 'standard').reasons.map((r) => r.code)).toContain('too_many_steps');
    expect(assessCaseDetail(bloated, 'standard').status).toBe('OVER_DETAILED');

    const prose = goodCase('TC_O_002');
    prose.steps[1].expected_result = 'x'.repeat(400);
    expect(assessCaseDetail(prose, 'standard').status).toBe('OVER_DETAILED');
  });

  it('uses the detail level: 4 steps is fine for concise but TOO_VAGUE for standard', () => {
    const four = goodCase('TC_L_001');
    four.steps = four.steps.slice(0, 4);
    expect(assessCaseDetail(four, 'concise').status).toBe('APPROPRIATE');
    expect(assessCaseDetail(four, 'standard').status).toBe('TOO_VAGUE');
  });

  it('a long precise sentence containing generic words is NOT flagged as vague', () => {
    const c = goodCase('TC_P_001');
    c.steps[3].expected_result = "Hệ thống xử lý thành công yêu cầu và trả về HTTP 200 kèm body {status:'ok'} trong vòng 2 giây, chuyển sang /dashboard";
    expect(assessCaseDetail(c, 'standard').status).toBe('APPROPRIATE');
  });
});

describe('Required taxonomy support (deterministic ceiling)', () => {
  it('MISSING with zero cases, PARTIALLY below the minimum, SUPPORTED at/above it', () => {
    const cases = [
      ...['1', '2', '3', '4'].map((n) => goodCase(`TC_P_00${n}`, 'positive')),
      goodCase('TC_N_001', 'negative'),
    ];
    const { analysis } = analyze(cases);
    const byCat = Object.fromEntries(analysis.taxonomy.map((t) => [t.category, t.ceiling]));
    expect(byCat).toEqual({ positive: 'SUPPORTED', negative: 'PARTIALLY_SUPPORTED', boundary: 'MISSING' });
  });
});

describe('finalizeReview — the model can make findings worse, never better', () => {
  const cases = [
    ...['1', '2', '3', '4'].map((n) => goodCase(`TC_P_00${n}`, 'positive')),
    goodCase('TC_N_001', 'negative'),
    vagueCase('TC_V_001', 'negative'),
  ];

  function run(model: z.input<typeof reviewModelOutputSchema> | null) {
    const { analysis } = analyze(cases);
    return finalizeReview({ model_output: model && modelOutput(model), analysis, test_cases: cases });
  }

  it('cannot upgrade a MISSING category to SUPPORTED, or a below-minimum one past PARTIALLY_SUPPORTED', () => {
    const review = run({
      language_detail: [],
      taxonomy: [
        { category: 'boundary', status: 'SUPPORTED', evidence: 'looks like boundary', supporting_codes: ['TC_P_001'] },
        { category: 'negative', status: 'SUPPORTED', evidence: 'has negative', supporting_codes: ['TC_N_001'] },
        { category: 'positive', status: 'SUPPORTED', evidence: 'TC_P_001 asserts /dashboard', supporting_codes: ['TC_P_001'] },
      ],
      issues: [],
      recommendations: [],
    });
    const byCat = Object.fromEntries(review.taxonomy.map((t) => [t.category, t.status]));
    expect(byCat.boundary).toBe('MISSING');
    expect(byCat.negative).toBe('PARTIALLY_SUPPORTED');
    expect(byCat.positive).toBe('SUPPORTED');
    expect(review.overall_status).toBe('FAIL'); // a required category is missing
  });

  it('never claims SUPPORTED from a count alone: no model confirmation => INSUFFICIENT_EVIDENCE', () => {
    const review = run(null);
    expect(review.taxonomy.find((t) => t.category === 'positive')?.status).toBe('INSUFFICIENT_EVIDENCE');
  });

  it('a required category is never NOT_APPLICABLE, and SUPPORTED without evidence is not accepted', () => {
    const review = run({
      language_detail: [],
      taxonomy: [
        { category: 'positive', status: 'NOT_APPLICABLE', evidence: 'n/a', supporting_codes: [] },
        { category: 'negative', status: 'SUPPORTED', evidence: '', supporting_codes: [] },
      ],
      issues: [],
      recommendations: [],
    });
    expect(review.taxonomy.find((t) => t.category === 'positive')?.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(review.taxonomy.find((t) => t.category === 'negative')?.status).not.toBe('SUPPORTED');
  });

  it('rule findings cannot be erased by the model; the model can add worse ones', () => {
    const review = run({
      language_detail: [
        { test_case_code: 'TC_V_001', status: 'OVER_DETAILED', reason: 'too long' }, // tries to soften
        { test_case_code: 'TC_P_001', status: 'TOO_VAGUE', reason: "Step 3 says 'nhập mật khẩu' without the value" },
        { test_case_code: 'TC_GHOST', status: 'TOO_VAGUE', reason: 'hallucinated case' },
      ],
      taxonomy: [],
      issues: [],
      recommendations: [],
    });
    const byCode = Object.fromEntries(review.language_detail.issues.map((i) => [i.test_case_code, i]));
    expect(byCode.TC_V_001.status).toBe('TOO_VAGUE'); // stays the rule's verdict
    expect(byCode.TC_P_001.status).toBe('TOO_VAGUE');
    expect(byCode.TC_P_001.source).toBe('ai');
    expect(byCode.TC_GHOST).toBeUndefined();
    expect(review.language_detail.counts).toEqual({ TOO_VAGUE: 2, OVER_DETAILED: 0, APPROPRIATE: 4 });
  });

  it('drops findings without evidence or with an unknown test case, and clamps everything to REVIEW_LIMITS', () => {
    const long = 'z'.repeat(1000);
    const review = run({
      language_detail: [],
      taxonomy: [{ category: 'positive', status: 'SUPPORTED', evidence: long, supporting_codes: ['TC_P_001', 'TC_P_002', 'TC_P_003', 'TC_P_004'] }],
      issues: [
        ...Array.from({ length: 12 }, (_, i) => ({
          test_case_code: 'TC_V_001',
          severity: 'Minor' as const,
          area: 'consistency' as const,
          description: `${long}${i}`,
          evidence: long,
        })),
        { test_case_code: 'TC_GHOST', severity: 'Critical' as const, area: 'taxonomy' as const, description: 'invented', evidence: 'x' },
        { test_case_code: 'TC_P_001', severity: 'Critical' as const, area: 'executability' as const, description: 'no evidence', evidence: '' },
      ],
      recommendations: Array.from({ length: 20 }, () => long),
    });
    expect(review.issues.length).toBeLessThanOrEqual(REVIEW_LIMITS.maxIssues);
    expect(review.issues.every((i) => i.test_case_code !== 'TC_GHOST')).toBe(true);
    expect(review.issues.every((i) => i.evidence.length <= REVIEW_LIMITS.maxEvidenceChars)).toBe(true);
    expect(review.issues.every((i) => i.description.length <= REVIEW_LIMITS.maxDescriptionChars)).toBe(true);
    expect(review.recommendations.length).toBeLessThanOrEqual(REVIEW_LIMITS.maxRecommendations);
    expect(review.recommendations.every((r) => r.length <= REVIEW_LIMITS.maxRecommendationChars)).toBe(true);
    expect(review.taxonomy.every((t) => t.evidence.length <= REVIEW_LIMITS.maxEvidenceChars)).toBe(true);
    expect(review.taxonomy.every((t) => t.supporting_codes.length <= REVIEW_LIMITS.maxSupportingCodes)).toBe(true);
    expect(review.language_detail.issues.length).toBeLessThanOrEqual(REVIEW_LIMITS.maxLanguageDetailIssues);
  });

  it('overall status is computed: PASS only when everything is clean', () => {
    const clean = [...['1', '2', '3', '4'].map((n) => goodCase(`TC_P_00${n}`, 'positive'))];
    const { analysis } = analyze(clean, 'standard', ['positive'] as const);
    const ok = finalizeReview({
      model_output: modelOutput({
        language_detail: [],
        taxonomy: [{ category: 'positive', status: 'SUPPORTED', evidence: 'TC_P_001 asserts /dashboard and audit log', supporting_codes: ['TC_P_001'] }],
        issues: [],
        recommendations: [],
      }),
      analysis,
      test_cases: clean,
    });
    expect(ok.overall_status).toBe('PASS');

    const withMinor = finalizeReview({
      model_output: modelOutput({
        language_detail: [],
        taxonomy: [{ category: 'positive', status: 'SUPPORTED', evidence: 'TC_P_001 asserts /dashboard', supporting_codes: ['TC_P_001'] }],
        issues: [{ test_case_code: 'TC_P_002', severity: 'Minor', area: 'consistency', description: 'title wording', evidence: 'TC_P_002 title' }],
        recommendations: [],
      }),
      analysis,
      test_cases: clean,
    });
    expect(withMinor.overall_status).toBe('NEEDS_IMPROVEMENT');
  });
});

describe('Enhance planning is focused and grounded', () => {
  it('targets only cases with findings, and only proven taxonomy gaps allow new cases', () => {
    const cases = [
      ...['1', '2', '3', '4'].map((n) => goodCase(`TC_P_00${n}`, 'positive')),
      vagueCase('TC_V_001', 'positive'),
    ];
    const { analysis } = analyze(cases, 'standard', ['positive'] as const);
    const review = { taxonomy: [{ category: 'positive', status: 'INSUFFICIENT_EVIDENCE', evidence: '', supporting_codes: [] }], language_detail: { issues: [] }, issues: [] } as unknown as ReviewResult;
    const plan = planEnhancement({ test_cases: cases, analysis, review });

    expect(plan.targets.map((t) => t.code)).toEqual(['TC_V_001']);
    // INSUFFICIENT_EVIDENCE is not a proven gap -> Enhance may NOT invent cases for it.
    expect(plan.taxonomy_gaps).toEqual([]);
  });
});
