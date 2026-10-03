// ============================================================================
// File: src/services/ai/output-budget.ts
// OUTPUT-SIZE PLANNING — turns "how much will the model have to write?" into
// arithmetic, so oversized work is SPLIT before the call instead of failing
// (truncation / timeout / bad JSON) after it.
// ----------------------------------------------------------------------------
// Old approach: ONE call for every selected category, and a static "floor cap"
// (model-registry.ts getGenerationCategoryFloorCap) that LOWERED the required
// cases-per-category (e.g. 8 categories at `standard` -> 1 case each) to squeeze
// under the output limit. That traded QA coverage for fitting in one response.
//
// New approach: estimate the output of a unit of work; if it exceeds the safe
// share of maxOutputTokens, split it into bounded batches that EACH keep the
// full per-category minimum. Same (or better) coverage, bounded requests.
//
// Pure: no env, no clock, no I/O. (Env knobs are read by callers and passed in.)
// ============================================================================

import type { TestCaseCategory } from '@/models/validators/test-case';
import { normalizeDetailLevel, type DetailLevel } from './quality-standards';

/**
 * Estimated OUTPUT tokens for ONE test case, by detail level, at the MID-RANGE
 * step count of the bounds in quality-standards.ts (concise 5, standard 8,
 * detailed 11 steps), ~3 chars/token. Measured against a realistic fixture:
 * concise ~345, standard ~463, detailed ~587 — so these are at or above
 * measurement (detailed deliberately generous). output-budget.test.ts
 * ("calibration") re-measures on every run, so a change to the step rules that
 * invalidates these numbers fails a test instead of silently under-budgeting.
 */
export const TOKENS_PER_CASE: Record<DetailLevel, number> = {
  concise: 360,
  standard: 480,
  detailed: 760,
};

/** Fixed output overhead of Generate's `analysis` object (the 7-layer audit trail). */
export const GENERATION_ANALYSIS_TOKENS = 1_500;
/** Per document atom: its line in analysis.document_atom_plan + coverage_self_check. */
export const TOKENS_PER_ATOM_PLAN = 40;

/**
 * Share of maxOutputTokens the VISIBLE output may use. The remainder absorbs
 * thinking tokens (they count against maxOutputTokens), estimation error and
 * model verbosity. 0.55 leaves ~45% headroom: the failure being avoided is a
 * hard truncation, which loses everything after the cut.
 */
export const SAFE_OUTPUT_FRACTION = 0.55;

export function safeOutputTokens(maxOutputTokens: number): number {
  return Math.floor(maxOutputTokens * SAFE_OUTPUT_FRACTION);
}

export function estimateCasesTokens(detailLevel: string | undefined, caseCount: number): number {
  return Math.ceil(TOKENS_PER_CASE[normalizeDetailLevel(detailLevel)] * Math.max(0, caseCount));
}

export function estimateGenerationOutputTokens(input: {
  detailLevel: string | undefined;
  caseCount: number;
  atomCount: number;
}): number {
  return GENERATION_ANALYSIS_TOKENS + input.atomCount * TOKENS_PER_ATOM_PLAN + estimateCasesTokens(input.detailLevel, input.caseCount);
}

/**
 * Split categories into the FEWEST ordered batches whose estimated output fits
 * the safe budget. A batch always holds at least one category (a single
 * category that exceeds the budget is still attempted alone — splitting a
 * category further would break its minimum-case guarantee; truncation of that
 * batch is then handled by the orchestrator).
 */
export function planCategoryBatches(input: {
  categories: readonly TestCaseCategory[];
  detailLevel: string | undefined;
  perCategoryMin: number;
  atomCount: number;
  maxOutputTokens: number;
}): TestCaseCategory[][] {
  const budget = safeOutputTokens(input.maxOutputTokens);
  const fixed = GENERATION_ANALYSIS_TOKENS + input.atomCount * TOKENS_PER_ATOM_PLAN;
  const perCategory = estimateCasesTokens(input.detailLevel, input.perCategoryMin);

  const batches: TestCaseCategory[][] = [];
  let current: TestCaseCategory[] = [];
  for (const category of input.categories) {
    const wouldBe = fixed + (current.length + 1) * perCategory;
    if (current.length > 0 && wouldBe > budget) {
      batches.push(current);
      current = [];
    }
    current.push(category);
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/** Max atoms per coverage-repair call so that its (~1 case / 1.5 atoms) output fits the safe budget. */
export function planRepairBatchSize(input: {
  detailLevel: string | undefined;
  maxOutputTokens: number;
  /** Operator-configured ceiling (AI_COVERAGE_REPAIR_BATCH_SIZE); the plan never exceeds it. */
  configuredSize: number;
}): number {
  const REPAIR_FIXED_OVERHEAD_TOKENS = 600;
  const perAtom = TOKENS_PER_CASE[normalizeDetailLevel(input.detailLevel)] / 1.5;
  const fit = Math.floor((safeOutputTokens(input.maxOutputTokens) - REPAIR_FIXED_OVERHEAD_TOKENS) / perAtom);
  return Math.max(3, Math.min(input.configuredSize, fit));
}

/** maxOutputTokens sized to the work (2x estimate for thinking/verbosity), within [floor, ceiling]. */
export function maxOutputTokensFor(estimatedOutputTokens: number, bounds: { floor: number; ceiling: number }): number {
  return Math.min(bounds.ceiling, Math.max(bounds.floor, Math.ceil(estimatedOutputTokens * 2)));
}

/**
 * Per-attempt timeout sized to the work: fixed latency + output at an assumed
 * generation speed. A small repair batch no longer gets the same 100s as a full
 * generation (so it fails fast), and a big one is not starved.
 */
export function computeAttemptTimeoutMs(
  estimatedOutputTokens: number,
  options: { tokensPerSecond: number; baseMs?: number; floorMs?: number; ceilingMs?: number },
): number {
  const baseMs = options.baseMs ?? 20_000;
  const floorMs = options.floorMs ?? 30_000;
  const ceilingMs = options.ceilingMs ?? 150_000;
  const ms = baseMs + (estimatedOutputTokens / Math.max(1, options.tokensPerSecond)) * 1000;
  return Math.round(Math.min(ceilingMs, Math.max(floorMs, ms)));
}
