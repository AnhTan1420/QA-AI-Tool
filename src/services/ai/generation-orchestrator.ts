// ============================================================================
// File: src/services/ai/generation-orchestrator.ts
// BOUNDED, RESUMABLE GENERATION.
// ----------------------------------------------------------------------------
//   categories ──plan──> batches (each fits the safe output budget)
//        │
//        └─ for each batch, while the shared budget can fund it:
//             estimate output -> size timeout + maxOutputTokens to the work
//             -> ONE engine call (the engine owns retry/fallback)
//             -> validate -> normalize -> merge/dedupe into the suite
//             -> on OUTPUT_TRUNCATED / REQUEST_TOO_LARGE / TIMEOUT: SPLIT the batch
//                (never replay the same request) and keep what was salvaged
//   out of budget / provider down -> stop, return everything completed so far
//                                    + exactly which categories remain (resume)
//
// Replaces the single "every category in one response" call. Each batch keeps
// the FULL per-category minimum; the old floor cap that lowered it to fit one
// response is no longer needed.
// ============================================================================

import type { ParsedDocument } from '@/models/validators/document';
import {
  generatedTestCasesSchema,
  generationAnalysisSchema,
  type GeneratedTestCase,
  type GenerationAnalysis,
  type TestCaseCategory,
} from '@/models/validators/test-case';
import { buildGenerationPrompt } from './prompts/generation-agent';
import { buildGenerationResponseSchema } from './prompts/generation-response-schema';
import { runGeminiTask } from './provider';
import { GeminiProviderError, type FailureCode } from './errors';
import { MAX_SPLIT_DEPTH, isSplittableFailure } from './retry-policy';
import type { ExecutionBudget } from './execution-budget';
import {
  computeAttemptTimeoutMs,
  estimateGenerationOutputTokens,
  maxOutputTokensFor,
  planCategoryBatches,
} from './output-budget';
import {
  getAssumedOutputTokensPerSecond,
  getExplicitCategoryFloorCap,
  getGenerationMaxOutputTokens,
  getGenerationRequestTimeoutMs,
} from './model-registry';
import { getDetailLevelRules, normalizeDetailLevel } from './quality-standards';
import { unwrapArrayResponse, validateAIJson } from './parse';
import { mergeTestCases, normalizeGeneratedTestCases, type SemanticIssue } from './test-case-validation';
import { countAtoms } from './source-context';

type QueuedBatch = { categories: TestCaseCategory[]; depth: number };

export type BatchOutcome = {
  categories: TestCaseCategory[];
  status: 'ok' | 'truncated' | 'split' | 'failed' | 'deferred';
  cases_added: number;
  failure?: FailureCode;
};

export type GenerationPayload = { analysis: GenerationAnalysis | null; test_cases: GeneratedTestCase[] };

export type OrchestrationInput = {
  requirement_description: string;
  retrieved_old_test_cases: GeneratedTestCase[];
  language: string;
  detail_level: string;
  /** Categories still to generate (already excludes completed ones). */
  categories: TestCaseCategory[];
  /** Documents as shown to the prompt (atom-capped). */
  prompt_documents: ParsedDocument[];
  /** FULL documents — the source of truth for atom-id validation. */
  all_documents: ParsedDocument[];
  /** Cases from earlier in this run / a previous partial response. */
  existing: GeneratedTestCase[];
  budget: ExecutionBudget;
};

export type OrchestrationResult = {
  test_cases: GeneratedTestCase[];
  analysis: GenerationAnalysis | null;
  completed_categories: TestCaseCategory[];
  remaining_categories: TestCaseCategory[];
  batches: BatchOutcome[];
  issues: SemanticIssue[];
  truncated: boolean;
  models_used: string[];
  stop_failure?: FailureCode;
};

function validateGeneration(raw: unknown): GenerationPayload {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const testCases = validateAIJson(generatedTestCasesSchema, unwrapArrayResponse(obj.test_cases ?? raw), 'generation test_cases');
  // "analysis" is audit-trail data, NOT a success condition.
  const parsedAnalysis = generationAnalysisSchema.safeParse(obj.analysis);
  return { analysis: parsedAnalysis.success ? parsedAnalysis.data : null, test_cases: testCases };
}

function splitInHalf<T>(items: T[]): [T[], T[]] {
  const mid = Math.ceil(items.length / 2);
  return [items.slice(0, mid), items.slice(mid)];
}

export async function runBoundedGeneration(input: OrchestrationInput): Promise<OrchestrationResult> {
  const detail = normalizeDetailLevel(input.detail_level);
  const maxOut = getGenerationMaxOutputTokens();
  // Per-category minimum is the NOMINAL one: batching bounds output, so the old
  // quality-lowering cap is only honoured when an operator sets it explicitly.
  const explicitCap = getExplicitCategoryFloorCap();
  const perMin = explicitCap
    ? Math.max(1, Math.min(getDetailLevelRules(detail).perCategoryMin, Math.floor(explicitCap / Math.max(1, input.categories.length))))
    : getDetailLevelRules(detail).perCategoryMin;
  const atomCount = countAtoms(input.prompt_documents);

  const queue: QueuedBatch[] = planCategoryBatches({
    categories: input.categories,
    detailLevel: detail,
    perCategoryMin: perMin,
    atomCount,
    maxOutputTokens: maxOut,
  }).map((categories) => ({ categories, depth: 0 }));
  let totalBatches = queue.length;
  let testCases = input.existing;
  let analysis: GenerationAnalysis | null = null;
  const issues: SemanticIssue[] = [];
  const batches: BatchOutcome[] = [];
  const modelsUsed = new Set<string>();
  const completed = new Set<TestCaseCategory>();
  let truncated = false;
  let stopFailure: FailureCode | undefined;
  let deferred: QueuedBatch[] = [];
  let lastProviderError: GeminiProviderError | undefined;
  let batchNumber = 0;

  while (queue.length > 0) {
    const queued = queue.shift()!;
    const batch = queued.categories;
    const estOut = estimateGenerationOutputTokens({ detailLevel: detail, caseCount: batch.length * perMin, atomCount });
    const timeoutMs = computeAttemptTimeoutMs(estOut, {
      tokensPerSecond: getAssumedOutputTokensPerSecond(),
      ceilingMs: getGenerationRequestTimeoutMs(),
    });
    const minAttemptMs = Math.round(timeoutMs * 0.5);

    if (!input.budget.canAfford(minAttemptMs)) {
      stopFailure = 'SERVER_BUDGET_EXHAUSTED';
      deferred = [queued, ...queue];
      batches.push({ categories: batch, status: 'deferred', cases_added: 0, failure: stopFailure });
      break;
    }

    batchNumber++;
    try {
      const result = await runGeminiTask<GenerationPayload>({
        task: 'generation',
        prompt: buildGenerationPrompt({
          requirement_description: input.requirement_description,
          retrieved_old_test_cases: input.retrieved_old_test_cases,
          selected_categories: batch,
          language: input.language,
          detail_level: detail,
          document_context: input.prompt_documents,
          category_floor_cap: explicitCap ? perMin * batch.length : undefined,
          already_generated: testCases.map((tc) => ({ code: tc.code, title: tc.title, category: tc.category })),
          batch: { index: batchNumber, total: Math.max(totalBatches, batchNumber) },
        }),
        responseSchema: buildGenerationResponseSchema(),
        timeoutMs,
        minAttemptMs,
        maxOutputTokens: maxOutputTokensFor(estOut, { floor: 6_144, ceiling: maxOut }),
        budget: input.budget,
        label: `batch ${batchNumber}/${Math.max(totalBatches, batchNumber)}`,
        telemetry: { batch: batchNumber, batches: Math.max(totalBatches, batchNumber), categories: batch.length, est_out_tokens: estOut, atoms: atomCount },
        validate: validateGeneration,
      });

      modelsUsed.add(result.model);
      analysis ??= result.data.analysis;
      const normalized = normalizeGeneratedTestCases(result.data.test_cases, input.all_documents);
      issues.push(...normalized.issues);
      const merged = mergeTestCases(testCases, normalized.test_cases);
      testCases = merged.test_cases;

      let outcome: BatchOutcome = { categories: batch, status: 'ok', cases_added: merged.added.length };
      if (result.truncated) {
        truncated = true;
        outcome = { ...outcome, status: 'truncated' };
        issues.push({
          code: 'truncated_response',
          severity: 'warning',
          message: `Lô ${batchNumber} bị cắt cụt vì vượt giới hạn token đầu ra — đã giữ phần hợp lệ; các category chưa đủ số case tối thiểu sẽ được sinh lại theo lô nhỏ hơn.`,
        });
        // Re-queue ONLY categories the salvaged part did not satisfy, in smaller pieces.
        const unmet = batch.filter((c) => merged.added.filter((tc) => tc.category === c).length < perMin);
        const canRetryUnmet = unmet.length > 0 && queued.depth < MAX_SPLIT_DEPTH && (batch.length > 1 || unmet.length < batch.length);
        if (canRetryUnmet) {
          const pieces = unmet.length === batch.length ? splitInHalf(unmet) : [unmet];
          queue.unshift(...pieces.filter((p) => p.length > 0).map((categories) => ({ categories, depth: queued.depth + 1 })));
          totalBatches += pieces.length - 1;
          outcome = { ...outcome, status: 'split' };
          batch.filter((c) => !unmet.includes(c)).forEach((c) => completed.add(c));
        } else {
          batch.forEach((c) => completed.add(c));
        }
      } else {
        batch.forEach((c) => completed.add(c));
      }
      batches.push(outcome);
    } catch (error) {
      if (!(error instanceof GeminiProviderError)) throw error;
      const failure = error.meta.failure ?? 'UNKNOWN';
      lastProviderError = error;
      if (failure === 'AUTH_ERROR') throw error;

      if (isSplittableFailure(failure) && batch.length > 1 && queued.depth < MAX_SPLIT_DEPTH) {
        const [a, b] = splitInHalf(batch);
        queue.unshift({ categories: a, depth: queued.depth + 1 }, { categories: b, depth: queued.depth + 1 });
        totalBatches += 1;
        batches.push({ categories: batch, status: 'split', cases_added: 0, failure });
        issues.push({
          code: 'batch_split',
          severity: 'warning',
          message: `Lô ${batchNumber} (${batch.length} category) thất bại (${failure}) — chia đôi và thử lại với yêu cầu nhỏ hơn.`,
        });
        continue;
      }

      stopFailure = failure;
      deferred = [queued, ...queue];
      batches.push({ categories: batch, status: 'failed', cases_added: 0, failure });
      break;
    }
  }

  const remaining = deferred.flatMap((b) => b.categories);
  // Nothing produced AND a hard failure: surface it (the route returns the provider error)
  // rather than returning an empty "partial" the client would resume forever.
  const producedNothing = testCases.length === input.existing.length;
  if (remaining.length > 0 && producedNothing && lastProviderError) throw lastProviderError;
  if (remaining.length > 0 && producedNothing && stopFailure === 'SERVER_BUDGET_EXHAUSTED') {
    throw new GeminiProviderError('Không đủ ngân sách thời gian để chạy ngay cả một lô.', {
      task: 'generation',
      attemptedModels: [],
      lastKind: 'fatal',
      failure: 'SERVER_BUDGET_EXHAUSTED',
    });
  }
  if (remaining.length > 0) {
    issues.push({
      code: 'generation_deferred',
      severity: 'warning',
      message: `Mới hoàn thành ${completed.size}/${input.categories.length} category trong lượt này (${stopFailure ?? 'hết ngân sách thời gian'}). Còn lại: ${remaining.join(', ')} — tiếp tục để xử lý phần còn lại.`,
    });
  }

  return {
    test_cases: testCases,
    analysis,
    completed_categories: [...completed],
    remaining_categories: remaining,
    batches,
    issues,
    truncated,
    models_used: [...modelsUsed],
    stop_failure: stopFailure,
  };
}
