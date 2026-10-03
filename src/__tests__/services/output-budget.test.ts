import { describe, it, expect } from 'vitest';
import {
  GENERATION_ANALYSIS_TOKENS,
  SAFE_OUTPUT_FRACTION,
  TOKENS_PER_ATOM_PLAN,
  TOKENS_PER_CASE,
  computeAttemptTimeoutMs,
  estimateCasesTokens,
  estimateGenerationOutputTokens,
  maxOutputTokensFor,
  planCategoryBatches,
  planRepairBatchSize,
  safeOutputTokens,
} from '@/services/ai/output-budget';
import { estimateTokens } from '@/services/ai/ai-telemetry';
import { DETAIL_LEVEL_RULES, type DetailLevel } from '@/services/ai/quality-standards';
import { goodCase } from '../helpers/review-fixtures';
import type { TestCaseCategory } from '@/models/validators/test-case';

const ALL: TestCaseCategory[] = ['positive', 'negative', 'boundary', 'ui_ux', 'compatibility', 'performance', 'security', 'integration', 'regression', 'accessibility', 'localization'];

/** A realistic case with `n` steps, shaped like the Generate prompt demands (concrete, Vietnamese). */
function caseWithSteps(n: number) {
  const c = goodCase('TC_CAL_001');
  const template = c.steps[1];
  c.steps = Array.from({ length: n }, (_, i) => ({ ...template, step_number: i + 1 }));
  return c;
}

describe('calibration: TOKENS_PER_CASE vs real fixtures', () => {
  // Typical (mid-range) step count per level, from the shared step bounds.
  const typical: Record<DetailLevel, number> = {
    concise: Math.round((DETAIL_LEVEL_RULES.concise.minSteps + DETAIL_LEVEL_RULES.concise.maxSteps) / 2),
    standard: Math.round((DETAIL_LEVEL_RULES.standard.minSteps + DETAIL_LEVEL_RULES.standard.maxSteps) / 2),
    detailed: Math.round((DETAIL_LEVEL_RULES.detailed.minSteps + DETAIL_LEVEL_RULES.detailed.maxSteps) / 2),
  };

  it.each(['concise', 'standard', 'detailed'] as DetailLevel[])(
    'the %s estimate is not BELOW a measured case (an under-estimate defeats batching)',
    (level) => {
      const measured = estimateTokens(JSON.stringify(caseWithSteps(typical[level])).length);
      expect(TOKENS_PER_CASE[level]).toBeGreaterThanOrEqual(measured);
    },
  );

  it('estimates grow with detail level', () => {
    expect(TOKENS_PER_CASE.concise).toBeLessThan(TOKENS_PER_CASE.standard);
    expect(TOKENS_PER_CASE.standard).toBeLessThan(TOKENS_PER_CASE.detailed);
  });
});

describe('estimates', () => {
  it('generation output = analysis overhead + per-atom plan + cases', () => {
    expect(estimateGenerationOutputTokens({ detailLevel: 'standard', caseCount: 10, atomCount: 15 })).toBe(
      GENERATION_ANALYSIS_TOKENS + 15 * TOKENS_PER_ATOM_PLAN + 10 * TOKENS_PER_CASE.standard,
    );
    expect(estimateCasesTokens('bogus', 2)).toBe(2 * TOKENS_PER_CASE.standard); // unknown level -> standard
  });

  it('safe output is a fraction of the ceiling, leaving headroom for thinking tokens', () => {
    expect(safeOutputTokens(16_384)).toBe(Math.floor(16_384 * SAFE_OUTPUT_FRACTION));
    expect(SAFE_OUTPUT_FRACTION).toBeLessThan(0.7);
  });
});

describe('planCategoryBatches — oversized work is split BEFORE the call', () => {
  const plan = (detailLevel: DetailLevel, categories: TestCaseCategory[], atomCount = 0) =>
    planCategoryBatches({
      categories,
      detailLevel,
      perCategoryMin: DETAIL_LEVEL_RULES[detailLevel].perCategoryMin,
      atomCount,
      maxOutputTokens: 16_384,
    });

  it('every batch fits the safe output budget (except an unavoidable single category)', () => {
    for (const level of ['concise', 'standard', 'detailed'] as DetailLevel[]) {
      for (const atoms of [0, 15]) {
        const batches = plan(level, ALL, atoms);
        for (const batch of batches) {
          const est = estimateGenerationOutputTokens({
            detailLevel: level,
            caseCount: batch.length * DETAIL_LEVEL_RULES[level].perCategoryMin,
            atomCount: atoms,
          });
          if (batch.length > 1) expect(est).toBeLessThanOrEqual(safeOutputTokens(16_384));
        }
      }
    }
  });

  it('preserves EVERY category exactly once, in order — splitting never drops coverage', () => {
    for (const level of ['concise', 'standard', 'detailed'] as DetailLevel[]) {
      expect(plan(level, ALL, 10).flat()).toEqual(ALL);
    }
  });

  it('keeps the FULL per-category minimum in every batch (no quality-lowering cap)', () => {
    // Old behaviour: 11 categories at standard under the cap of 14 -> 1 case/category.
    const batches = plan('standard', ALL);
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.length).toBeLessThanOrEqual(ALL.length);
  });

  it('small workloads stay a single call; heavier detail levels need more batches', () => {
    expect(plan('standard', ['positive', 'negative', 'boundary'])).toHaveLength(1);
    // 11 concise categories ~ 9.4k estimated tokens > the 9.0k safe budget -> honestly 2 calls, not 1.
    expect(plan('concise', ALL).length).toBeLessThanOrEqual(2);
    expect(plan('detailed', ALL).length).toBeGreaterThan(plan('standard', ALL).length);
  });

  it('more document atoms (bigger analysis output) -> smaller batches', () => {
    expect(plan('standard', ALL, 60).length).toBeGreaterThanOrEqual(plan('standard', ALL, 0).length);
  });

  it('a single oversized category is still attempted alone rather than dropped', () => {
    const batches = planCategoryBatches({ categories: ['security'], detailLevel: 'detailed', perCategoryMin: 6, atomCount: 500, maxOutputTokens: 4_096 });
    expect(batches).toEqual([['security']]);
  });
});

describe('planRepairBatchSize', () => {
  it('shrinks with detail level and never exceeds the configured ceiling', () => {
    const size = (detailLevel: DetailLevel, configuredSize = 35) => planRepairBatchSize({ detailLevel, maxOutputTokens: 16_384, configuredSize });
    expect(size('detailed')).toBeLessThan(size('standard'));
    expect(size('standard')).toBeLessThanOrEqual(35);
    expect(size('concise', 10)).toBe(10);
    expect(size('detailed')).toBeGreaterThanOrEqual(3);
  });

  it('a repair batch fits the safe output budget', () => {
    for (const level of ['concise', 'standard', 'detailed'] as DetailLevel[]) {
      const n = planRepairBatchSize({ detailLevel: level, maxOutputTokens: 16_384, configuredSize: 200 });
      const est = Math.ceil((n * TOKENS_PER_CASE[level]) / 1.5) + 600;
      expect(est).toBeLessThanOrEqual(safeOutputTokens(16_384));
    }
  });
});

describe('sizing timeouts and output caps to the work', () => {
  it('timeout scales with expected output, within floor and ceiling', () => {
    const opts = { tokensPerSecond: 90 };
    const small = computeAttemptTimeoutMs(500, opts);
    const big = computeAttemptTimeoutMs(8_000, opts);
    expect(small).toBeLessThan(big);
    expect(small).toBeGreaterThanOrEqual(30_000);
    expect(computeAttemptTimeoutMs(10_000_000, opts)).toBe(150_000);
    expect(computeAttemptTimeoutMs(8_000, { ...opts, ceilingMs: 60_000 })).toBe(60_000);
  });

  it('a slower assumed speed gives more time', () => {
    expect(computeAttemptTimeoutMs(6_000, { tokensPerSecond: 40 })).toBeGreaterThan(computeAttemptTimeoutMs(6_000, { tokensPerSecond: 200 }));
  });

  it('maxOutputTokens is 2x the estimate, clamped to [floor, ceiling]', () => {
    expect(maxOutputTokensFor(3_000, { floor: 6_144, ceiling: 16_384 })).toBe(6_144);
    expect(maxOutputTokensFor(5_000, { floor: 6_144, ceiling: 16_384 })).toBe(10_000);
    expect(maxOutputTokensFor(50_000, { floor: 6_144, ceiling: 16_384 })).toBe(16_384);
  });
});
