import { NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { runGeminiTask } from '@/services/ai/provider';
import { GeminiProviderError } from '@/services/ai/errors';
import {
  ENHANCE_SYSTEM_PROMPT,
  ENHANCE_WORK_SYSTEM_PROMPT,
  buildEnhancePrompt,
  buildEnhanceWorkPrompt,
  buildEnhanceWorkResponseSchema,
} from '@/services/ai/prompts/enhance-agent';
import { buildEnhanceResponseSchema } from '@/services/ai/prompts/generation-response-schema';
import {
  generatedTestCasesSchema,
  generationAnalysisSchema,
  retrievedTestCaseSchema,
  reviewResultSchema,
  testCaseCategorySchema,
  type GeneratedTestCase,
  type ReviewResult,
} from '@/models/validators/test-case';
import { parsedDocumentSchema } from '@/models/validators/document';
import { unwrapArrayResponse, validateAIJson } from '@/services/ai/parse';
import { computeDocumentCoverage } from '@/services/documents/coverage';
import { getAssumedOutputTokensPerSecond, getEnhanceMaxOutputTokens, getExplicitCategoryFloorCap } from '@/services/ai/model-registry';
import { createRouteBudget } from '@/services/ai/execution-budget';
import { computeAttemptTimeoutMs, estimateCasesTokens, safeOutputTokens } from '@/services/ai/output-budget';
import {
  ENHANCE_LIMITS,
  getRequiredCategories,
  normalizeDetailLevel,
  resolvePerCategoryMin,
} from '@/services/ai/quality-standards';
import { analyzeTestCases, truncate } from '@/services/ai/review-analysis';
import { runEnhanceWork } from '@/services/ai/enhance-orchestrator';
import { ENHANCE_LEGACY_PROMPT_VERSION, ENHANCE_PROMPT_VERSION, MODEL_RESOLUTION_STATUSES, type EnhanceWorkOutput } from '@/services/ai/enhance-work';
import type { ReviewFinding } from '@/services/ai/review-findings';
import type { L0Context } from '@/services/ai/review-pipeline';
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
  /** Generation's persisted analysis (risk_ranking drives Q11 checks). Optional. */
  generation_analysis: generationAnalysisSchema.optional(),
  /**
   * Work-order mode only: apply exactly these findings (by fingerprint; ids are re-assigned per run).
   * Omitted => Critical and Major findings of High/Medium confidence.
   */
  selected_fingerprints: z.array(z.string()).max(100).optional(),
  min_severity: z.enum(['Critical', 'Major', 'Minor']).optional(),
});

const enhanceModelOutputSchema = z.object({
  test_cases: z.array(z.unknown()).default([]),
  changes: z.array(z.string()).default([]),
});


// ── Work-order mode (Enhance v2): the model returns patches + resolutions ────

const patchSetSchema = z.object({
  title: z.string().optional(),
  preconditions: z.array(z.string()).optional(),
  test_data_entries: z.array(z.object({ field: z.string(), value: z.coerce.string() })).optional(),
  steps: z
    .array(z.object({ step_number: z.coerce.number().default(0), action: z.string().default(''), expected_result: z.string().default('') }))
    .optional(),
  final_expected_result: z.string().optional(),
  priority: z.string().optional(),
  category: z.string().optional(),
  source_requirement_ids: z.array(z.string()).optional(),
});

const enhanceWorkOutputSchema = z.object({
  patches: z.array(z.object({ code: z.string(), set: patchSetSchema.default({}) })).default([]),
  new_cases: z.array(z.object({ finding_id: z.string(), test_case: z.unknown() })).default([]),
  resolutions: z
    .array(
      z.object({
        finding_id: z.string(),
        status: z.enum(MODEL_RESOLUTION_STATUSES).catch('PARTIAL'),
        test_case_codes: z.array(z.string()).default([]),
        note: z.string().default(''),
      }),
    )
    .default([]),
  changes: z.array(z.string()).default([]),
});

/** One bad new case must not discard the whole reply: invalid ones are dropped, the rest kept. */
function validateWorkOutput(raw: unknown): EnhanceWorkOutput {
  const obj = validateAIJson(enhanceWorkOutputSchema, raw && typeof raw === 'object' ? raw : {}, 'enhance work result');
  const new_cases: EnhanceWorkOutput['new_cases'] = [];
  for (const nc of obj.new_cases) {
    const parsed = generatedTestCasesSchema.safeParse(unwrapArrayResponse([nc.test_case]));
    if (parsed.success && parsed.data[0]) new_cases.push({ finding_id: nc.finding_id, test_case: parsed.data[0] });
  }
  return { patches: obj.patches as EnhanceWorkOutput['patches'], new_cases, resolutions: obj.resolutions, changes: obj.changes };
}

/** A model attempt is only worth starting when this much time is left. */
const ENHANCE_MIN_CALL_MS = 20_000;

export async function POST(request: Request) {
  const budget = createRouteBudget(maxDuration, 'enhance');
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
      getExplicitCategoryFloorCap(),
    );


    // ── Enhance v2: the Review FINDINGS are the work order ───────────────────────────────
    // A review saved before the redesign has no `findings`; it takes the legacy path below,
    // unchanged. Everything the model returns in v2 is verified by code (enhance-verify.ts).
    if (review.findings !== undefined) {
      const l0: L0Context = {
        requirement_description: payload.requirement_description,
        documents,
        language: payload.language,
        detail_level: detailLevel,
        required_categories: requiredCategories,
        per_category_min: perCategoryMin,
        generation_analysis: payload.generation_analysis,
      };
      const budgetTokens = safeOutputTokens(getEnhanceMaxOutputTokens());
      const attemptMs = computeAttemptTimeoutMs(budgetTokens + 400, { tokensPerSecond: getAssumedOutputTokensPerSecond() });
      const suiteIndex = currentCases.map((tc) => ({ code: tc.code, title: tc.title, category: tc.category }));

      const run = await runEnhanceWork({
        cases: currentCases,
        client_findings: review.findings as unknown as ReviewFinding[],
        strengths: review.strengths ?? [],
        open_questions: review.open_questions ?? [],
        l0,
        selection: { selected_fingerprints: payload.selected_fingerprints, min_severity: payload.min_severity },
        budget_tokens: budgetTokens,
        canStartCall: () => budget.canAfford(ENHANCE_MIN_CALL_MS),
        callModel: async ({ batch, retry }) => {
          const res = await runGeminiTask<EnhanceWorkOutput>({
            task: 'enhance',
            systemPrompt: ENHANCE_WORK_SYSTEM_PROMPT,
            prompt: buildEnhanceWorkPrompt({
              requirement_description: payload.requirement_description,
              detail_level: detailLevel,
              required_categories: requiredCategories,
              per_category_min: perCategoryMin,
              language: payload.language,
              batch,
              cases: currentCases,
              strengths: review.strengths ?? [],
              open_questions: review.open_questions ?? [],
              suite_index: suiteIndex,
              documents,
              retry,
            }),
            responseSchema: buildEnhanceWorkResponseSchema(),
            maxOutputTokens: getEnhanceMaxOutputTokens(),
            timeoutMs: attemptMs,
            minAttemptMs: Math.round(attemptMs * 0.5),
            budget,
            thinkingLevel: 'low',
            validate: validateWorkOutput,
          });
          return { data: res.data, model: res.model, truncated: res.truncated };
        },
      });

      const issues: SemanticIssue[] = [...run.issues];
      const finalCases = run.test_cases;
      const semantic = validateGeneratedTestCases(finalCases, { documents });
      issues.push(...semantic.issues);
      const finalCoverage = computeDocumentCoverage(documents, finalCases);
      const status: 'completed' | 'coverage_incomplete' | 'validation_failed' = !semantic.is_valid
        ? 'validation_failed'
        : !finalCoverage || finalCoverage.is_complete
          ? 'completed'
          : 'coverage_incomplete';
      const nothingToDo = run.calls === 0 && run.removed_codes.length === 0;

      return NextResponse.json({
        success: true,
        data: {
          status,
          test_cases: finalCases,
          document_coverage: finalCoverage,
          analysis: {
            gaps_addressed: run.changes.map((c) => truncate(c, ENHANCE_LIMITS.maxChangeSummaryChars)),
            atoms_newly_covered: [],
            total_cases_before: currentCases.length,
            total_cases_after: finalCases.length,
          },
          revised_test_cases: run.revised_codes,
          added_test_cases: run.added_codes,
          removed_test_cases: run.removed_codes,
          rejected_changes: run.rejected,
          deferred_test_cases: [...new Set(run.deferred.flatMap((d) => d.codes))],
          model_used: run.models[0] ?? null,
          truncated: run.truncated,
          issues,
          ...(nothingToDo ? { note: 'No actionable findings at the selected severity — nothing to enhance.' } : {}),
          // v2 additions
          prompt_version: ENHANCE_PROMPT_VERSION,
          work_orders: run.work_orders,
          resolutions: run.resolutions,
          unresolved: run.unresolved,
          deferred: run.deferred,
          waivers: run.waivers,
          delta: run.delta,
          previous_run: run.previous_run,
          plan: run.plan,
          model_calls: run.calls,
        },
      });
    }

    // Same deterministic rules Review used — recomputed, not trusted from the client.
    const analysis = analyzeTestCases({
      test_cases: currentCases,
      detail_level: detailLevel,
      required_categories: requiredCategories,
      per_category_min: perCategoryMin,
      documents,
      language: payload.language,
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
          prompt_version: ENHANCE_LEGACY_PROMPT_VERSION,
          note: 'No actionable Review findings — nothing to enhance.',
        },
      });
    }

    // Timeout sized to the expected output (targets rewritten + any allowed new cases).
    const expectedCases = plan.targets.length + plan.taxonomy_gaps.reduce((n, g) => n + g.allowed_new, 0);
    const enhanceTimeoutMs = computeAttemptTimeoutMs(estimateCasesTokens(detailLevel, expectedCases) + 400, {
      tokensPerSecond: getAssumedOutputTokensPerSecond(),
    });

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
      timeoutMs: enhanceTimeoutMs,
      minAttemptMs: Math.round(enhanceTimeoutMs * 0.5),
      budget,
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
        // Targets the model did not get to (truncated reply) are reported as deferred so the
        // user can run Enhance again, instead of silently looking "done".
        deferred_test_cases: [
          ...plan.deferred_codes,
          ...(enhanced.truncated ? plan.targets.map((t) => t.code).filter((code) => !applied.revised_codes.includes(code)) : []),
        ],
        model_used: enhanced.model,
        truncated: enhanced.truncated,
        issues,
        prompt_version: ENHANCE_LEGACY_PROMPT_VERSION,
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
