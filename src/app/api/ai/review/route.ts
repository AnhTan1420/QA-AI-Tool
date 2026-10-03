import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { runGeminiTask } from '@/services/ai/provider';
import { GeminiProviderError } from '@/services/ai/errors';
import {
  REVIEW_SYSTEM_PROMPT,
  buildReviewPrompt,
  buildReviewResponseSchema,
} from '@/services/ai/prompts/review-agent';
import {
  retrievedTestCaseSchema,
  reviewModelOutputSchema,
  testCaseCategorySchema,
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
import { analyzeTestCases, finalizeReview } from '@/services/ai/review-analysis';

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
});

export async function POST(request: Request) {
  const budget = createRouteBudget(maxDuration, 'review');
  try {
    const payload = requestSchema.parse(await request.json());
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
    });
    const coverage = computeDocumentCoverage(documents, cases);

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

    // 3) Deterministic pass again — clamp, drop unevidenced findings, compute status.
    const review = finalizeReview({ model_output: result.data, analysis, test_cases: cases });

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
      });
      return NextResponse.json({ success: false, error: error.userMessage }, { status: 503 });
    }
    console.error('❌ Lỗi API AI (review):', error);
    const message = error instanceof Error ? error.message : 'Lỗi không xác định';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
