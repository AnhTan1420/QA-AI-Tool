import { CATEGORY_VALUES, type GeneratedTestCase, type TestCaseCategory } from '@/models/validators/test-case';
import type { DocumentCoverageResult } from '@/services/documents/coverage';
import type { DeterministicAnalysis } from '../review-analysis';
import { truncate } from '../review-analysis';
import { REVIEW_LIMITS, renderQualityStandardsForPrompt } from '../quality-standards';

// ============================================================================
// Review = a BOUNDED QA evaluation against the SAME standard Generate uses.
//
//   It answers:  "what is wrong / missing / inconsistent with the generation
//                 standard?"
//   It never:    rewrites a test case, proposes replacement cases, scores with
//                 invented dimensions, or writes out its reasoning.
//   Fixing is Enhance's job (prompts/enhance-agent.ts, AI_MODEL_ENHANCE).
//
// The limits below are mirrored in code (REVIEW_LIMITS + finalizeReview), so
// they hold even if the model ignores them.
// ============================================================================

export const REVIEW_SYSTEM_PROMPT = `You are evaluating an existing QA test case suite.

Use the SAME quality standard used by the Generate workflow (given in the user message).

Evaluate:
1. Language & Detail Level (TOO_VAGUE / APPROPRIATE / OVER_DETAILED)
2. Required Taxonomy Support (does a case genuinely exercise the category, judged from its actual content, not from words that merely sound related)
3. Executability
4. Evidence-backed quality gaps

Evaluate the supplied test cases against the configured generation-quality rules and required taxonomy. Return only concise, evidence-backed findings. Do not perform unnecessary analysis, do not rewrite the test case, and do not output hidden reasoning.

Rules:
- Do not rewrite test cases. Do not generate alternative or replacement test cases.
- Do not invent requirements, business rules, edge cases, security concerns or taxonomy requirements that are not in the supplied source or configuration.
- If evidence is insufficient, use INSUFFICIENT_EVIDENCE (taxonomy) or omit the finding. Never speculate.
- Do not reward length. Do not reward repetition. A longer test case is not a better test case.
- Facts computed by the application (counts, step totals, structure) are authoritative; do not recompute or contradict them.
- No chain-of-thought, no explanations of obvious observations, no preamble.
- Return ONLY the JSON object in the schema. All JSON keys stay in English; text values use the language of the requirement.`;

export type ReviewPromptInput = {
  requirement_description: string;
  test_cases: GeneratedTestCase[];
  detail_level: string;
  required_categories: readonly TestCaseCategory[];
  per_category_min: number;
  analysis: DeterministicAnalysis;
  /** Deterministic coverage summary only — never the full atom list. */
  document_coverage: DocumentCoverageResult | null;
};

/**
 * Choose which cases the model sees. Flagged cases first (so semantic checks
 * land where problems are), then a per-category sample so every required
 * category has evidence to judge, then the rest in order.
 */
export function selectCasesForReview(
  testCases: GeneratedTestCase[],
  analysis: DeterministicAnalysis,
  requiredCategories: readonly TestCaseCategory[],
  perCategoryMin: number,
  limit: number = REVIEW_LIMITS.maxCasesInPrompt,
): GeneratedTestCase[] {
  if (testCases.length <= limit) return testCases;

  const chosen = new Set<string>();
  const byCode = new Map(testCases.map((tc) => [tc.code, tc]));
  const push = (code: string) => {
    if (chosen.size < limit && byCode.has(code)) chosen.add(code);
  };

  for (const assessed of analysis.cases) if (assessed.status !== 'APPROPRIATE') push(assessed.test_case_code);
  for (const category of requiredCategories) {
    testCases
      .filter((tc) => tc.category === category)
      .slice(0, Math.max(1, perCategoryMin))
      .forEach((tc) => push(tc.code));
  }
  for (const tc of testCases) push(tc.code);

  return testCases.filter((tc) => chosen.has(tc.code));
}

/** One compact block per case: enough to judge, nowhere near the full JSON. */
export function formatCaseDigest(tc: GeneratedTestCase): string {
  const data = Object.entries(tc.test_data ?? {})
    .slice(0, 4)
    .map(([k, v]) => `${k}=${truncate(v, 30)}`)
    .join('; ');
  const steps = (tc.steps ?? [])
    .slice(0, REVIEW_LIMITS.maxStepsInPrompt)
    .map(
      (s, i) =>
        `  ${i + 1}. ${truncate(s.action, REVIEW_LIMITS.maxActionCharsInPrompt)} => ${truncate(s.expected_result, REVIEW_LIMITS.maxActionCharsInPrompt)}`,
    )
    .join('\n');
  const total = tc.steps?.length ?? 0;
  const more = total > REVIEW_LIMITS.maxStepsInPrompt ? `\n  … (${total} steps total)` : '';
  return `${tc.code} [${tc.category}/${tc.priority}] ${truncate(tc.title, 120)}
  data: ${data || '(none)'}
${steps}${more}
  final: ${truncate(tc.final_expected_result, 140)}`;
}

function formatCoverageSummary(coverage: DocumentCoverageResult | null): string {
  if (!coverage) return '(no documents attached)';
  const head = `Document coverage (application-computed): ${coverage.covered_atoms}/${coverage.total_atoms} atoms = ${coverage.coverage_percent}%.`;
  if (coverage.is_complete) return head;
  const shown = coverage.uncovered.slice(0, REVIEW_LIMITS.maxUncoveredAtomsInPrompt);
  const list = shown.map((a) => `  [${a.atom_id}] ${truncate(a.label, 70)}`).join('\n');
  const rest = coverage.uncovered.length - shown.length;
  return `${head}\nUncovered (${coverage.uncovered.length}):\n${list}${rest > 0 ? `\n  … and ${rest} more` : ''}`;
}

function formatFacts(input: ReviewPromptInput): string {
  const { analysis } = input;
  const perCategory = analysis.taxonomy
    .map(
      (t) =>
        `  ${t.category}: ${t.case_count} case(s) [${t.codes.slice(0, 8).join(', ')}${t.codes.length > 8 ? ', …' : ''}] — application ceiling ${t.ceiling}`,
    )
    .join('\n');
  const flagged = analysis.cases
    .filter((c) => c.status !== 'APPROPRIATE')
    .slice(0, 15)
    .map((c) => `  ${c.test_case_code}: ${c.status} (${c.reasons.map((r) => r.code).join(', ')})`)
    .join('\n');
  return `Suite: ${input.test_cases.length} cases. Rule-based detail check: ${analysis.counts.TOO_VAGUE} TOO_VAGUE, ${analysis.counts.OVER_DETAILED} OVER_DETAILED, ${analysis.counts.APPROPRIATE} APPROPRIATE.
Cases per required category (you may CONFIRM or DOWNGRADE the ceiling, never exceed it):
${perCategory}
Already flagged by rules (do not repeat these; only add cases the rules cannot see):
${flagged || '  (none)'}`;
}

/** Output contract text. Mirrors buildReviewResponseSchema() below. */
const OUTPUT_CONTRACT = `OUTPUT (JSON object, exactly these keys, nothing else):
{
  "language_detail": [ { "test_case_code": "TC_X", "status": "TOO_VAGUE | OVER_DETAILED", "reason": "<=${REVIEW_LIMITS.maxDescriptionChars} chars" } ],
  "taxonomy": [ { "category": "<one required category>", "status": "SUPPORTED | PARTIALLY_SUPPORTED | MISSING | INSUFFICIENT_EVIDENCE", "evidence": "<=${REVIEW_LIMITS.maxEvidenceChars} chars, cite case codes", "supporting_codes": ["TC_X"] } ],
  "issues": [ { "test_case_code": "TC_X", "severity": "Critical | Major | Minor", "area": "language_detail | taxonomy | executability | consistency", "description": "<=${REVIEW_LIMITS.maxDescriptionChars} chars", "evidence": "<=${REVIEW_LIMITS.maxEvidenceChars} chars, quote or point to the case/source" } ],
  "recommendations": [ "<=${REVIEW_LIMITS.maxRecommendationChars} chars each; say WHAT to improve, do not write the improved test case" ]
}
LIMITS: language_detail max ${REVIEW_LIMITS.maxLanguageDetailIssues} entries (only non-APPROPRIATE cases); taxonomy exactly one entry per required category; issues max ${REVIEW_LIMITS.maxIssues}; recommendations max ${REVIEW_LIMITS.maxRecommendations}; supporting_codes max ${REVIEW_LIMITS.maxSupportingCodes}. Prefer few meaningful findings over many repetitive ones.`;

export function buildReviewPrompt(input: ReviewPromptInput): string {
  const shown = selectCasesForReview(input.test_cases, input.analysis, input.required_categories, input.per_category_min);
  const omitted = input.test_cases.length - shown.length;
  const requirement = truncate(input.requirement_description, REVIEW_LIMITS.maxRequirementChars);

  return `${renderQualityStandardsForPrompt({
    detailLevel: input.detail_level,
    requiredCategories: input.required_categories,
    perCategoryMin: input.per_category_min,
  })}

[APPLICATION FACTS — authoritative]
${formatFacts(input)}

[SOURCE REQUIREMENT]
${requirement}
${formatCoverageSummary(input.document_coverage)}

[TEST CASES${omitted > 0 ? ` — ${shown.length} of ${input.test_cases.length} shown (flagged and per-category samples first); the rest were checked by rules only` : ''}]
${shown.map(formatCaseDigest).join('\n')}

${OUTPUT_CONTRACT}`;
}

/**
 * Gemini responseSchema for Review. maxItems mirrors REVIEW_LIMITS. There is no
 * "reasoning"/"analysis" property, so the model has nowhere to put chain-of-
 * thought. (If a model rejects the schema the engine retries schema-free; the
 * server-side clamps in finalizeReview still apply.)
 */
export function buildReviewResponseSchema(requiredCategoryCount: number): Record<string, unknown> {
  const STRING = { type: 'STRING' };
  return {
    type: 'OBJECT',
    properties: {
      language_detail: {
        type: 'ARRAY',
        maxItems: REVIEW_LIMITS.maxLanguageDetailIssues,
        items: {
          type: 'OBJECT',
          properties: {
            test_case_code: STRING,
            status: { type: 'STRING', enum: ['TOO_VAGUE', 'OVER_DETAILED'] },
            reason: STRING,
          },
          required: ['test_case_code', 'status', 'reason'],
          propertyOrdering: ['test_case_code', 'status', 'reason'],
        },
      },
      taxonomy: {
        type: 'ARRAY',
        maxItems: Math.max(1, requiredCategoryCount),
        items: {
          type: 'OBJECT',
          properties: {
            category: { type: 'STRING', enum: [...CATEGORY_VALUES] },
            status: {
              type: 'STRING',
              enum: ['SUPPORTED', 'PARTIALLY_SUPPORTED', 'MISSING', 'INSUFFICIENT_EVIDENCE'],
            },
            evidence: STRING,
            supporting_codes: { type: 'ARRAY', maxItems: REVIEW_LIMITS.maxSupportingCodes, items: STRING },
          },
          required: ['category', 'status', 'evidence', 'supporting_codes'],
          propertyOrdering: ['category', 'status', 'evidence', 'supporting_codes'],
        },
      },
      issues: {
        type: 'ARRAY',
        maxItems: REVIEW_LIMITS.maxIssues,
        items: {
          type: 'OBJECT',
          properties: {
            test_case_code: STRING,
            severity: { type: 'STRING', enum: ['Critical', 'Major', 'Minor'] },
            area: { type: 'STRING', enum: ['language_detail', 'taxonomy', 'executability', 'consistency'] },
            description: STRING,
            evidence: STRING,
          },
          required: ['severity', 'area', 'description', 'evidence'],
          propertyOrdering: ['test_case_code', 'severity', 'area', 'description', 'evidence'],
        },
      },
      recommendations: { type: 'ARRAY', maxItems: REVIEW_LIMITS.maxRecommendations, items: STRING },
    },
    required: ['language_detail', 'taxonomy', 'issues', 'recommendations'],
    propertyOrdering: ['language_detail', 'taxonomy', 'issues', 'recommendations'],
  };
}
