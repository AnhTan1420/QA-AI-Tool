import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { runGeminiTask } from '@/services/ai/provider';
import { GeminiProviderError } from '@/services/ai/errors';
import { ENHANCE_SYSTEM_PROMPT, buildEnhancePrompt } from '@/services/ai/prompts/enhance-agent';
import { buildEnhanceResponseSchema } from '@/services/ai/prompts/generation-response-schema';
import {
  generatedTestCasesSchema,
  retrievedTestCaseSchema,
  reviewResultSchema,
  testCaseCategorySchema,
  type GeneratedTestCase,
  type ReviewResult,
} from '@/models/validators/test-case';
import { parsedDocumentSchema } from '@/models/validators/document';
import { unwrapArrayResponse, validateAIJson } from '@/services/ai/parse';
import { computeDocumentCoverage } from '@/services/documents/coverage';
import { getEnhanceMaxOutputTokens, getGenerationCategoryFloorCap } from '@/services/ai/model-registry';
import {
  ENHANCE_LIMITS,
  getRequiredCategories,
  normalizeDetailLevel,
  resolvePerCategoryMin,
} from '@/services/ai/quality-standards';
import { analyzeTestCases, truncate } from '@/services/ai/review-analysis';
import { applyEnhancement, isNoOpPlan, planEnhancement } from '@/services/ai/enhance-merge';
import {
  normalizeGeneratedTestCases,
  validateGeneratedTestCases,
  type SemanticIssue,
} from '@/services/ai/test-case-validation';

// One bounded call; no repair loop, so the Generate-sized 300s budget is not needed.
export const maxDuration = 120;
export const runtime = 'nodejs';

/**
 * Enhance: targeted improvement of existing test cases, grounded in
 *   source requirements + the Review findings + the generation quality standard.
 * Model chain:
 *     AI_MODEL_ENHANCE -> AI_MODEL_PRIMARY -> fallbacks     (task: 'enhance')
 * It never touches AI_MODEL_REVIEW.
 *
 * It does NOT re-run coverage repair (that is a Generate-side task with its own
 * model). What Enhance may change is enforced in code — see enhance-merge.ts.
 */
const requestSchema = z.object({
  requirement_description: z.string().min(20),
  test_cases: z.array(retrievedTestCaseSchema).min(1),
  // Structured Review findings only — never the review conversation.
  review_result: reviewResultSchema,
  document_context: z.array(parsedDocumentSchema).optional().default([]),
  selected_categories: z.array(testCaseCategorySchema).optional(),
  language: z.string().min(2).default('Tiếng Việt'),
  detail_level: z.enum(['concise', 'standard', 'detailed']).default('standard'),
});

const enhanceModelOutputSchema = z.object({
  test_cases: z.array(z.unknown()).default([]),
  changes: z.array(z.string()).default([]),
});

export async function POST(request: Request) {
  try {
    const payload = requestSchema.parse(await request.json());
    const documents = payload.document_context ?? [];
    const currentCases = payload.test_cases as GeneratedTestCase[];
    const review = payload.review_result as ReviewResult;
    const detailLevel = normalizeDetailLevel(payload.detail_level);

    const requiredCategories = getRequiredCategories(payload.selected_categories);
    const perCategoryMin = resolvePerCategoryMin(
      detailLevel,
      requiredCategories.length,
      getGenerationCategoryFloorCap(detailLevel),
    );

    // Same deterministic rules Review used — recomputed, not trusted from the client.
    const analysis = analyzeTestCases({
      test_cases: currentCases,
      detail_level: detailLevel,
      required_categories: requiredCategories,
      per_category_min: perCategoryMin,
      documents,
    });
    const plan = planEnhancement({ test_cases: currentCases, analysis, review });
    const coverageBefore = computeDocumentCoverage(documents, currentCases);

    // Nothing actionable -> no model call, suite returned unchanged.
    if (isNoOpPlan(plan)) {
      return NextResponse.json({
        success: true,
        data: {
          status: coverageBefore && !coverageBefore.is_complete ? 'coverage_incomplete' : 'completed',
          test_cases: currentCases,
          document_coverage: coverageBefore,
          analysis: { gaps_addressed: [], atoms_newly_covered: [], total_cases_before: currentCases.length, total_cases_after: currentCases.length },
          revised_test_cases: [],
          added_test_cases: [],
          rejected_changes: [],
          deferred_test_cases: [],
          model_used: null,
          truncated: false,
          issues: [],
          note: 'No actionable Review findings — nothing to enhance.',
        },
      });
    }

    const enhanced = await runGeminiTask<{ test_cases: GeneratedTestCase[]; changes: string[] }>({
      task: 'enhance',
      systemPrompt: ENHANCE_SYSTEM_PROMPT,
      prompt: buildEnhancePrompt({
        requirement_description: payload.requirement_description,
        detail_level: detailLevel,
        required_categories: requiredCategories,
        per_category_min: perCategoryMin,
        plan,
        suite_index: currentCases.map((tc) => ({ code: tc.code, title: tc.title, category: tc.category })),
        documents,
      }),
      responseSchema: buildEnhanceResponseSchema(ENHANCE_LIMITS.maxChangeSummaries),
      maxOutputTokens: getEnhanceMaxOutputTokens(),
      thinkingLevel: 'low',
      validate: (raw) => {
        const obj = validateAIJson(enhanceModelOutputSchema, raw && typeof raw === 'object' ? raw : {}, 'enhance result');
        // Returning no cases is a legitimate answer ("nothing to change") — not a bad response.
        const testCases =
          obj.test_cases.length === 0
            ? []
            : validateAIJson(generatedTestCasesSchema, unwrapArrayResponse(obj.test_cases), 'enhanced test cases');
        return { test_cases: testCases, changes: obj.changes };
      },
    });

    const issues: SemanticIssue[] = [];
    if (enhanced.truncated) {
      issues.push({
        code: 'truncated_response',
        severity: 'warning',
        message:
          'Phản hồi Enhance bị cắt cụt vì vượt giới hạn token đầu ra — chỉ các case đã trả về đầy đủ được áp dụng; các case còn lại giữ nguyên.',
      });
    }

    // 1) Enforce what Enhance may change; untouched cases are kept as-is.
    const applied = applyEnhancement(currentCases, enhanced.data.test_cases, plan);
    for (const rejected of applied.rejected) {
      issues.push({
        code: 'unrequested_change_rejected',
        severity: 'warning',
        test_case_code: rejected.code,
        message: `Thay đổi bị từ chối (${rejected.reason}).`,
      });
    }

    // 2) Mechanical normalization + hallucinated atom_id removal.
    const normalized = normalizeGeneratedTestCases(applied.test_cases, documents);
    issues.push(...normalized.issues);
    const finalCases = normalized.test_cases;

    // 3) Final deterministic validation + honest coverage.
    const semantic = validateGeneratedTestCases(finalCases, { documents });
    issues.push(...semantic.issues);
    const finalCoverage = computeDocumentCoverage(documents, finalCases);
    const coverageComplete = !finalCoverage || finalCoverage.is_complete;
    const status: 'completed' | 'coverage_incomplete' | 'validation_failed' = !semantic.is_valid
      ? 'validation_failed'
      : coverageComplete
        ? 'completed'
        : 'coverage_incomplete';

    // Were the revised cases actually brought up to the standard?
    const revisedSet = new Set([...applied.revised_codes, ...applied.added_codes]);
    const recheck = analyzeTestCases({
      test_cases: finalCases,
      detail_level: detailLevel,
      required_categories: requiredCategories,
      per_category_min: perCategoryMin,
    });
    for (const c of recheck.cases) {
      if (revisedSet.has(c.test_case_code) && c.status !== 'APPROPRIATE') {
        issues.push({
          code: 'enhance_still_below_standard',
          severity: 'warning',
          test_case_code: c.test_case_code,
          message: `Sau Enhance, ${c.test_case_code} vẫn ${c.status}: ${c.reasons.map((r) => r.message).join(' ')}`,
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        status,
        test_cases: finalCases,
        document_coverage: finalCoverage,
        analysis: {
          gaps_addressed: enhanced.data.changes
            .slice(0, ENHANCE_LIMITS.maxChangeSummaries)
            .map((c) => truncate(c, ENHANCE_LIMITS.maxChangeSummaryChars)),
          atoms_newly_covered: [],
          total_cases_before: currentCases.length,
          total_cases_after: finalCases.length,
        },
        revised_test_cases: applied.revised_codes,
        added_test_cases: applied.added_codes,
        rejected_changes: applied.rejected,
        deferred_test_cases: plan.deferred_codes,
        model_used: enhanced.model,
        truncated: enhanced.truncated,
        issues,
      },
    });
  } catch (error) {
    if (error instanceof ZodError) {
      const message =
        'Dữ liệu đầu vào không hợp lệ: ' + error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ');
      return NextResponse.json({ success: false, error: message, details: error.issues }, { status: 400 });
    }
    if (error instanceof GeminiProviderError) {
      console.error('❌ [ai/enhance] Gemini provider error:', {
        task: error.meta.task,
        models: error.meta.attemptedModels,
        kind: error.meta.lastKind,
        status: error.meta.lastStatus,
      });
      return NextResponse.json({ success: false, error: error.userMessage }, { status: 503 });
    }
    console.error('❌ Lỗi API AI (enhance):', error);
    const message = error instanceof Error ? error.message : 'Lỗi không xác định';
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
