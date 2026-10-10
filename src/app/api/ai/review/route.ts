import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { runGeminiTask } from '@/services/ai/provider';
import { GeminiProviderError, safeErrorDetail } from '@/services/ai/errors';
import {
  REVIEW_PROMPT_VERSION,
  REVIEW_SYSTEM_PROMPT,
  buildReviewPrompt,
  buildReviewResponseSchema,
} from '@/services/ai/prompts/review-agent';
import {
  generationAnalysisSchema,
  previousRunSchema,
  retrievedTestCaseSchema,
  reviewModelOutputSchema,
  testCaseCategorySchema,
  waiverSchema,
  type GeneratedTestCase,
  type ReviewModelOutput,
} from '@/models/validators/test-case';
import { parsedDocumentSchema } from '@/models/validators/document';
import { validateAIJson } from '@/services/ai/parse';
import { computeDocumentCoverage } from '@/services/documents/coverage';
import { getAssumedOutputTokensPerSecond, getExplicitCategoryFloorCap, getReviewMaxOutputTokens } from '@/services/ai/model-registry';
import { createRouteBudget } from '@/services/ai/execution-budget';
import { computeAttemptTimeoutMs } from '@/services/ai/output-budget';
import { getRequiredCategories, normalizeDetailLevel, resolvePerCategoryMin } from '@/services/ai/quality-standards';
import { analyzeTestCases } from '@/services/ai/review-analysis';
import { detectNonStringTestData } from '@/services/ai/review-facts';
import { finalizeReviewV2, prepareReview } from '@/services/ai/review-pipeline';

// Review is one small, bounded call — it must never need Enhance-sized budgets.
export const maxDuration = 120;
export const runtime = 'nodejs';

/**
 * Review: evaluate existing test cases against the SAME generation standard
 * Generate used (services/ai/quality-standards.ts). Model chain:
 *     AI_MODEL_REVIEW -> AI_MODEL_PRIMARY -> fallbacks      (task: 'review')
 * It never touches AI_MODEL_ENHANCE. It returns findings only — no rewritten
 * or suggested test cases; improving them is /api/ai/enhance.
 */
const requestSchema = z.object({
  requirement_description: z.string().min(20),
  // Lenient: input may be an old Excel import, not AI output we can hold to the standard.
  test_cases: z.array(retrievedTestCaseSchema).min(1),
  document_context: z.array(parsedDocumentSchema).optional().default([]),
  /** The categories the set was generated for. Omitted -> Generate's default required set. */
  selected_categories: z.array(testCaseCategorySchema).optional(),
  language: z.string().min(2).default('Tiếng Việt'),
  detail_level: z.enum(['concise', 'standard', 'detailed']).default('standard'),
  /**
   * Generation's persisted PHASE 0 analysis (test_case_sets.analysis). Optional: when present
   * Q11 priorities are checked against its risk_ranking and ambiguous_terms ground Q13.
   */
  generation_analysis: generationAnalysisSchema.optional(),
  /** Findings Enhance declined last run. Review does not re-raise them unless the evidence changed. */
  waivers: z.array(waiverSchema).max(50).optional().default([]),
  /** Fingerprints of the previous Review, to report fixed / new / regressed / unchanged. */
  previous_run: previousRunSchema.optional(),
});

export async function POST(request: Request) {
  const budget = createRouteBudget(maxDuration, 'review');
  try {
    const body = await request.json();
    const payload = requestSchema.parse(body);
    // The schema coerces non-string test_data to strings, so only the RAW body can show it was wrong.
    const nonStringCodes = detectNonStringTestData((body as { test_cases?: unknown })?.test_cases);
    const documents = payload.document_context ?? [];
    const cases = payload.test_cases as GeneratedTestCase[];
    const detailLevel = normalizeDetailLevel(payload.detail_level);

    const requiredCategories = getRequiredCategories(payload.selected_categories);
    const perCategoryMin = resolvePerCategoryMin(
      detailLevel,
      requiredCategories.length,
      getExplicitCategoryFloorCap(),
    );

    // 1) Deterministic pass — everything measurable is decided here, not by the model.
    const analysis = analyzeTestCases({
      test_cases: cases,
      detail_level: detailLevel,
      required_categories: requiredCategories,
      per_category_min: perCategoryMin,
      documents,
      language: payload.language,
    });
    const coverage = computeDocumentCoverage(documents, cases);
    // L0: facts + mechanical findings (free, exact). The model only adds what code cannot see.
    const prepared = prepareReview({
      test_cases: cases,
      requirement_description: payload.requirement_description,
      documents,
      language: payload.language,
      detail_level: detailLevel,
      required_categories: requiredCategories,
      per_category_min: perCategoryMin,
      analysis,
      coverage,
      generation_analysis: payload.generation_analysis,
      waivers: payload.waivers,
      non_string_test_data_codes: nonStringCodes,
    });

    // 2) Bounded AI pass — semantic judgment only.
    const reviewTimeoutMs = computeAttemptTimeoutMs(getReviewMaxOutputTokens(), { tokensPerSecond: getAssumedOutputTokensPerSecond() });
    const result = await runGeminiTask<ReviewModelOutput>({
      task: 'review',
      systemPrompt: REVIEW_SYSTEM_PROMPT,
      prompt: buildReviewPrompt({
        requirement_description: payload.requirement_description,
        test_cases: cases,
        detail_level: detailLevel,
        required_categories: requiredCategories,
        per_category_min: perCategoryMin,
        analysis,
        document_coverage: coverage,
        language: payload.language,
        mode: prepared.mode,
        facts: prepared.facts,
        mechanical_findings: prepared.mechanical,
        grounding: prepared.grounding,
        waivers: payload.waivers,
      }),
      responseSchema: buildReviewResponseSchema(requiredCategories.length),
      maxOutputTokens: getReviewMaxOutputTokens(),
      // Timeout sized to the (small) output instead of a flat 60s; the shared budget keeps
      // retries/fallbacks from outliving the route.
      timeoutMs: reviewTimeoutMs,
      minAttemptMs: Math.round(reviewTimeoutMs * 0.5),
      budget,
      // Thinking tokens count against maxOutputTokens; Review needs judgment, not deliberation.
      thinkingLevel: 'low',
      temperature: 0.1,
      validate: (raw) => validateAIJson(reviewModelOutputSchema, raw, 'review result'),
    });

    // 3) Deterministic pass again — clamp, verify quotes, merge with L0, score, verdict.
    const review = finalizeReviewV2({
      model_output: result.data,
      analysis,
      test_cases: cases,
      prepared,
      required_categories: requiredCategories,
      coverage,
      waivers: payload.waivers,
      previous_run: payload.previous_run,
      prompt_version: REVIEW_PROMPT_VERSION,
    });

    return NextResponse.json({
      success: true,
      data: { ...review, document_coverage: coverage, model_used: result.model, truncated: result.truncated },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const message =
        'Dữ liệu đầu vào không hợp lệ: ' + error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      return NextResponse.json({ success: false, error: message, details: error.issues }, { status: 400 });
    }
    if (error instanceof GeminiProviderError) {
      console.error('❌ [ai/review] Gemini provider error:', {
        task: error.meta.task,
        models: error.meta.attemptedModels,
        kind: error.meta.lastKind,
        status: error.meta.lastStatus,
        detail: safeErrorDetail(error.meta.cause),
      });
      return NextResponse.json({ success: false, error: error.userMessage }, { status: 503 });
    }
    console.error('❌ Lỗi API AI (review):', error);
    const message = error instanceof Error ? error.message : 'Lỗi không xác định';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
