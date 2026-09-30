// ============================================================================
// File: src/services/ai/quality-standards.ts
// SINGLE SOURCE OF TRUTH for "what a good generated test case is".
// ----------------------------------------------------------------------------
//   Generate  -> reads these numbers/definitions when it builds its prompt
//   Review    -> evaluates test cases against the SAME numbers/definitions
//   Enhance   -> improves test cases toward the SAME numbers/definitions
//
// Before this file the standards were literals inside generation-agent.ts, and
// Review invented its own (a 12-dimension model that did not match Generate's
// 11 categories). That is how "Generate says valid / Review says invalid"
// happens. Do not re-declare any of these values anywhere else.
//
// Everything here is PURE and deterministic: no env reads, no model ids, no I/O.
// (Env-driven knobs such as the per-category floor cap stay in model-registry.ts
// and are passed in by the caller.)
// ============================================================================

import { CATEGORY_VALUES, type TestCaseCategory } from '@/models/validators/test-case';

export type DetailLevel = 'concise' | 'standard' | 'detailed';

// ── Detail-level rules ─────────────────────────────────────────────────────

export type DetailLevelRules = {
  /** Minimum cases per selected category (Generate PHASE 2 rule 8). */
  perCategoryMin: number;
  /** Minimum steps per case (Generate PHASE 2 rule 6 — "the #1 quality gate"). */
  minSteps: number;
  /**
   * Upper bound on steps per case. Generate never had one, but Review must be
   * able to tell APPROPRIATE from OVER_DETAILED with a measurable rule, and
   * Generate is now told the same bound so it cannot emit a case Review calls
   * over-detailed. Deliberately generous (~2x the minimum).
   */
  maxSteps: number;
};

export const DETAIL_LEVEL_RULES: Record<DetailLevel, DetailLevelRules> = {
  concise: { perCategoryMin: 2, minSteps: 3, maxSteps: 6 },
  standard: { perCategoryMin: 4, minSteps: 5, maxSteps: 10 },
  detailed: { perCategoryMin: 6, minSteps: 7, maxSteps: 14 },
};

export function normalizeDetailLevel(value: string | undefined | null): DetailLevel {
  return value === 'concise' || value === 'detailed' ? value : 'standard';
}

export function getDetailLevelRules(detailLevel: string | undefined | null): DetailLevelRules {
  return DETAIL_LEVEL_RULES[normalizeDetailLevel(detailLevel)];
}

/**
 * Categories treated as required when the caller did not say which were
 * selected. Same fallback Generate has always used for its minimum-case math.
 */
export const DEFAULT_REQUIRED_CATEGORIES: readonly TestCaseCategory[] = ['positive', 'negative', 'boundary'];

/**
 * Per-category minimum actually demanded of a run. `categoryFloorCap` (see
 * getGenerationCategoryFloorCap in model-registry.ts) only ever LOWERS the
 * nominal minimum, never raises it, and never goes below 1. Review uses the
 * same function so it never demands more than Generate was allowed to produce.
 */
export function resolvePerCategoryMin(
  detailLevel: string | undefined | null,
  categoryCount: number,
  categoryFloorCap?: number,
): number {
  const nominal = getDetailLevelRules(detailLevel).perCategoryMin;
  const count = Math.max(1, categoryCount);
  if (!categoryFloorCap) return nominal;
  return Math.max(1, Math.min(nominal, Math.floor(categoryFloorCap / count)));
}

export function getRequiredCategories(selected: readonly TestCaseCategory[] | undefined | null): TestCaseCategory[] {
  return selected && selected.length > 0 ? [...new Set(selected)] : [...DEFAULT_REQUIRED_CATEGORIES];
}

// ── Taxonomy definitions ───────────────────────────────────────────────────

export type TaxonomyDefinition = {
  value: TestCaseCategory;
  /** What a case must actually DO to count as supporting this category. */
  definition: string;
};

/**
 * Keyed by CATEGORY_VALUES (the enum Generate validates against), so a category
 * can never exist here that Generate does not know, or vice versa — the
 * Record<> type makes that a compile error. The definitions restate what
 * Generate's PHASE 2 rule 8 demands; they are evidence criteria, not keywords.
 */
export const TAXONOMY_DEFINITIONS: Record<TestCaseCategory, TaxonomyDefinition> = {
  positive: {
    value: 'positive',
    definition: 'Happy-path / main business flow with valid data and an observable success end-state.',
  },
  negative: {
    value: 'negative',
    definition: 'Invalid, missing or disallowed input/action, with a specific rejection (error text/code) asserted.',
  },
  boundary: {
    value: 'boundary',
    definition: 'Exact boundary values (min/max, min-1/max+1, empty, null, max length) stated in test_data and asserted.',
  },
  ui_ux: {
    value: 'ui_ux',
    definition: 'Displayed labels, states, messages and usability asserted against concrete on-screen text/elements.',
  },
  compatibility: {
    value: 'compatibility',
    definition: 'Behaviour verified on a named browser/device/OS/API version, not merely mentioned.',
  },
  performance: {
    value: 'performance',
    definition: 'A measurable threshold (response time, concurrent users, payload size) that is asserted.',
  },
  security: {
    value: 'security',
    definition: 'An actual attack/abuse input or access attempt (XSS, SQLi, auth bypass, IDOR, CSRF) with the defence asserted.',
  },
  integration: {
    value: 'integration',
    definition: 'Interaction with an API/downstream service/data flow, including its failure or contract behaviour.',
  },
  regression: {
    value: 'regression',
    definition: 'Previously-working or previously-fixed behaviour re-verified to be unchanged.',
  },
  accessibility: {
    value: 'accessibility',
    definition: 'Keyboard navigation, labels/roles, focus or contrast verified against a stated expectation.',
  },
  localization: {
    value: 'localization',
    definition: 'Locale-specific text, date/time, currency or diacritics verified with concrete locale data.',
  },
};

// Compile-time + runtime guard: every enum category has a definition.
for (const category of CATEGORY_VALUES) {
  if (!TAXONOMY_DEFINITIONS[category]) {
    throw new Error(`quality-standards: missing taxonomy definition for "${category}"`);
  }
}

export type TaxonomyStatus =
  | 'SUPPORTED'
  | 'PARTIALLY_SUPPORTED'
  | 'MISSING'
  | 'NOT_APPLICABLE'
  | 'INSUFFICIENT_EVIDENCE';

export type DetailStatus = 'TOO_VAGUE' | 'APPROPRIATE' | 'OVER_DETAILED';

// ── Language & detail: measurable rules ────────────────────────────────────

export const QUALITY_RULES = {
  /** A step action longer than this is prose, not one atomic action. */
  maxActionChars: 240,
  /** An expected result longer than this is explanation, not an assertion. */
  maxExpectedChars: 320,
  /** final_expected_result longer than this is over-detailed. */
  maxFinalExpectedChars: 480,
  /** Shorter than this, a final_expected_result cannot describe an end-state. */
  minFinalExpectedChars: 8,
  /** Vague-phrase matching only applies to short strings (see isVaguePhrase). */
  vaguePhraseMaxChars: 60,
} as const;

/**
 * Generic wording Generate's PHASE 2 rule 6/7/10 calls "INSTANT REJECTION".
 * Matched against short, normalized strings only, so a long precise sentence
 * that happens to contain "works correctly" is not flagged.
 */
export const VAGUE_PHRASES: readonly string[] = [
  'submit the form',
  'verify result',
  'verify the result',
  'check result',
  'check the result',
  'system works',
  'works correctly',
  'work correctly',
  'processed successfully',
  'nhập dữ liệu hợp lệ',
  'nhap du lieu hop le',
  'kiểm tra kết quả',
  'kiem tra ket qua',
  'hoạt động đúng',
  'hoạt động bình thường',
  'xử lý thành công',
];

export const PLACEHOLDER_TOKENS: ReadonlySet<string> = new Set([
  'n/a',
  'na',
  'tbd',
  'todo',
  'string',
  'abc',
  'xxx',
  '...',
  '-',
  '--',
  'none',
  'no',
  'ok',
  'test',
  'value',
  'step',
  'action',
  'expected',
  'expected result',
  'as expected',
  'works correctly',
  'work correctly',
  'hoat dong dung',
  'hoạt động đúng',
  'thanh cong',
  'thành công',
  'đúng như mong đợi',
  'không có lỗi',
]);

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Empty, a known placeholder token, or too short to be observable. */
export function isPlaceholder(value: string): boolean {
  const normalized = normalizeText(value);
  if (normalized.length === 0) return true;
  if (PLACEHOLDER_TOKENS.has(normalized)) return true;
  return normalized.length < 4;
}

/** A short string that IS (or is essentially only) generic wording. */
export function isVaguePhrase(value: string): boolean {
  const normalized = normalizeText(value);
  if (normalized.length === 0 || normalized.length > QUALITY_RULES.vaguePhraseMaxChars) return false;
  return VAGUE_PHRASES.some((phrase) => normalized === phrase || normalized.startsWith(`${phrase} `) || normalized.endsWith(` ${phrase}`));
}

// ── Review / Enhance output limits ─────────────────────────────────────────

/**
 * Hard, application-enforced caps on Review output. The prompt asks for them
 * AND the code truncates to them, so a chatty model cannot spend the token
 * budget on repetition. (Budget = getReviewMaxOutputTokens in model-registry.)
 */
export const REVIEW_LIMITS = {
  maxIssues: 5,
  maxLanguageDetailIssues: 5,
  maxRecommendations: 5,
  maxEvidenceChars: 160,
  maxDescriptionChars: 160,
  maxRecommendationChars: 200,
  maxSupportingCodes: 3,
  /** Cases sent to the model as digests; the rest are covered deterministically. */
  maxCasesInPrompt: 40,
  maxActionCharsInPrompt: 90,
  maxStepsInPrompt: 4,
  maxRequirementChars: 6_000,
  maxUncoveredAtomsInPrompt: 10,
} as const;

export const ENHANCE_LIMITS = {
  /** Existing cases sent to / returned by Enhance in one pass. */
  maxTargetCases: 12,
  /** New cases allowed per required category that Review found unsupported. */
  maxNewCasesPerCategory: 2,
  maxChangeSummaries: 8,
  maxChangeSummaryChars: 160,
  maxFindingsInPrompt: 12,
} as const;

// ── Prompt fragment shared by Review and Enhance ───────────────────────────

/**
 * Renders the quality standard as prompt text. Review and Enhance both embed
 * this exact block, so the wording of "what good looks like" cannot diverge
 * between the two — and both derive from the same constants Generate uses.
 */
export function renderQualityStandardsForPrompt(input: {
  detailLevel: string | undefined | null;
  requiredCategories: readonly TestCaseCategory[];
  perCategoryMin: number;
}): string {
  const rules = getDetailLevelRules(input.detailLevel);
  const level = normalizeDetailLevel(input.detailLevel);
  const categories = input.requiredCategories
    .map((c) => `  - ${c}: ${TAXONOMY_DEFINITIONS[c].definition}`)
    .join('\n');

  return `GENERATION QUALITY STANDARD (identical to the one used when the test cases were generated)
Detail level: ${level}
- Steps per case: at least ${rules.minSteps}, at most ${rules.maxSteps}. Fewer than ${rules.minSteps} usually means merged actions (TOO_VAGUE); more than ${rules.maxSteps} is OVER_DETAILED.
- One atomic action per step. Each action names a concrete screen/field/button and the real value from the case's test_data.
- Each step's expected_result is observable and verifiable at that step (status/error code, exact UI text). final_expected_result states the measurable end-state.
- Generic wording ("Submit the form", "Kiểm tra kết quả", "works correctly", "N/A") is TOO_VAGUE. Repeated information and long prose are OVER_DETAILED. A longer case is NOT a better case.
- Required categories, each needing at least ${input.perCategoryMin} distinct case(s) that genuinely exercise it:
${categories}`;
}
