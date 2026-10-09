// ============================================================================
// File: src/services/ai/enhance-orchestrator.ts
// Enhance v2 end to end, with the model call INJECTED:
//
//   fresh L0 + client semantic findings -> work orders -> selection -> budget plan
//   -> model call(s) -> apply (patches / ADD / SPLIT) -> ONE bounded retry for unresolved
//   -> guarded REMOVE -> normalize -> verify (re-run L0, rollback, delta) -> resolutions
//
// The route supplies `callModel` (Gemini); tests and the seeded-defect harness supply recorded
// responses. Nothing here touches env, clock or network.
// ============================================================================

import type { GeneratedTestCase } from '@/models/validators/test-case';
import type { ParsedDocument } from '@/models/validators/document';
import { ENHANCE_LIMITS } from '@/services/ai/quality-standards';
import { normalizeGeneratedTestCases, type SemanticIssue } from '@/services/ai/test-case-validation';
import { runL0, type L0Context } from '@/services/ai/review-pipeline';
import type { ReviewFinding, Waiver } from '@/services/ai/review-findings';
import {
  buildWorkOrders,
  planBatches,
  selectWorkOrders,
  splitByExecutor,
  type BatchItem,
  type Deferred,
  type EnhanceWorkOutput,
  type FinalResolution,
  type SelectionOptions,
  type WorkOrder,
} from '@/services/ai/enhance-work';
import {
  applyWorkOutputs,
  buildWaivers,
  emptyOutcome,
  estimateScoreAfter,
  executeRemovals,
  finalizeResolutions,
  unresolvedOrders,
  verifyMerge,
  type EnhanceDelta,
  type RejectedChange,
} from '@/services/ai/enhance-verify';

export type CallModel = (args: { batch: BatchItem[]; retry: boolean }) => Promise<{
  data: EnhanceWorkOutput;
  model: string | null;
  truncated: boolean;
}>;

export type EnhanceRunInput = {
  cases: GeneratedTestCase[];
  /** Findings from the client's Review (only origin 'semantic' ones are used; mechanical are recomputed). */
  client_findings: readonly ReviewFinding[];
  strengths: readonly string[];
  open_questions: readonly string[];
  l0: L0Context;
  selection?: SelectionOptions;
  /** Planner capacity per call: safeOutputTokens(getEnhanceMaxOutputTokens()). */
  budget_tokens: number;
  callModel: CallModel;
  /** Return false when the route has no time left for another model attempt. */
  canStartCall?: () => boolean;
};

export type EnhanceRunResult = {
  test_cases: GeneratedTestCase[];
  revised_codes: string[];
  added_codes: string[];
  removed_codes: string[];
  rejected: RejectedChange[];
  resolutions: FinalResolution[];
  unresolved: FinalResolution[];
  deferred: Deferred[];
  waivers: Waiver[];
  delta: EnhanceDelta;
  work_orders: WorkOrder[];
  calls: number;
  truncated: boolean;
  models: string[];
  changes: string[];
  issues: SemanticIssue[];
  /** For the next Review: fingerprints of this run and which of them Enhance resolved. */
  previous_run: { fingerprints: string[]; resolved_fingerprints: string[] };
  plan: { batches: number; batch_tokens: number[]; budget_tokens: number };
};

export async function runEnhanceWork(input: EnhanceRunInput): Promise<EnhanceRunResult> {
  const L = ENHANCE_LIMITS;
  const canStart = input.canStartCall ?? (() => true);
  const documents: ParsedDocument[] = input.l0.documents;
  const issues: SemanticIssue[] = [];
  const models: string[] = [];
  const changes: string[] = [];
  let calls = 0;
  let truncated = false;

  // 1) Facts are recomputed here; the client's semantic findings are re-clamped, never trusted.
  const l0 = runL0(input.cases, input.l0);
  const { orders } = buildWorkOrders({
    mechanical: l0.prepared.mechanical,
    clientFindings: input.client_findings,
    clamp: {
      knownCodes: new Set(input.cases.map((c) => c.code)),
      shownCodes: new Set(input.cases.map((c) => c.code)),
      mode: l0.prepared.mode,
      sourceText: l0.prepared.source_text,
      atomIds: l0.prepared.atom_ids,
      categories: new Set<string>(input.l0.required_categories),
      waivers: [],
    },
  });
  const semanticBefore = orders.filter((o) => o.origin === 'semantic');

  // 2) What is actionable now, and who executes it.
  const { actionable, advisory } = selectWorkOrders(orders, input.selection);
  const { model: modelOrders, removals } = splitByExecutor(actionable);

  // 3) Budget plan. One call is reserved for the single bounded retry.
  const plan = planBatches({
    orders: modelOrders,
    cases: input.cases,
    detail_level: input.l0.detail_level,
    budget_tokens: input.budget_tokens,
    max_calls: Math.max(1, L.maxCallsPerRun - 1),
  });
  const deferred: Deferred[] = [...plan.deferred];

  const runBatches = async (batches: BatchItem[][], retry: boolean): Promise<EnhanceWorkOutput[]> => {
    const outs: EnhanceWorkOutput[] = [];
    for (const batch of batches) {
      if (!canStart() || calls >= L.maxCallsPerRun) {
        for (const item of batch) {
          deferred.push({ finding_id: item.order.finding_id, fingerprint: item.order.fingerprint, rule: item.order.rule, codes: item.codes, reason: 'time_budget' });
        }
        continue;
      }
      calls++;
      const res = await input.callModel({ batch, retry });
      if (res.model) models.push(res.model);
      if (res.truncated) {
        truncated = true;
        issues.push({
          code: 'truncated_response',
          severity: 'warning',
          message: 'Phản hồi Enhance bị cắt cụt — chỉ phần đã trả về đầy đủ được áp dụng; phần còn lại được báo là chưa giải quyết.',
        });
      }
      outs.push(res.data);
      changes.push(...res.data.changes);
    }
    return outs;
  };

  // 4) First pass.
  let outcome = emptyOutcome(input.cases);
  const firstOutputs = await runBatches(plan.batches, false);
  outcome = applyWorkOutputs({ previous: outcome, orders: modelOrders, outputs: firstOutputs, detail_level: input.l0.detail_level, documents });

  // 5) Resolution coverage: ONE bounded retry with only the unresolved findings.
  const preResolutions = finalizeResolutions({
    all: orders, actionableModel: modelOrders, advisory, deferred, outcome,
    removal: { test_cases: outcome.test_cases, removed: [], refused: [] }, rolled_back: new Set(),
  });
  const retryOrders = unresolvedOrders(preResolutions, modelOrders);
  if (retryOrders.length > 0 && calls < L.maxCallsPerRun && canStart()) {
    const retryPlan = planBatches({
      orders: retryOrders,
      cases: outcome.test_cases,
      detail_level: input.l0.detail_level,
      budget_tokens: input.budget_tokens,
      max_calls: 1,
    });
    for (const d of retryPlan.deferred) deferred.push({ ...d, reason: `retry_${d.reason}` });
    const retryOutputs = await runBatches(retryPlan.batches, true);
    outcome = applyWorkOutputs({ previous: outcome, orders: retryOrders, outputs: retryOutputs, detail_level: input.l0.detail_level, documents });
  }

  // 6) REMOVE is executed here, after patches, and only when coverage and category minimums survive.
  const removal = executeRemovals({ cases: outcome.test_cases, orders: removals, documents, per_category_min: input.l0.per_category_min });

  // 7) Mechanical normalization (numbering, string-cast, hallucinated atom ids), then verification.
  const normalized = normalizeGeneratedTestCases(removal.test_cases, documents);
  issues.push(...normalized.issues);
  const removedCodes = new Set(removal.removed.map((r) => r.code));
  const patchedCodes = new Set([...outcome.patched.keys()].filter((c) => !removedCodes.has(c)));
  const newCodes = new Set(outcome.created.map((c) => c.code).filter((c) => !removedCodes.has(c)));
  const verified = verifyMerge({
    before: input.cases,
    after: normalized.test_cases,
    patched_codes: patchedCodes,
    new_codes: newCodes,
    l0: input.l0,
    semantic_before: semanticBefore,
  });
  const rolledBack = new Set([...verified.rolled_back.map((r) => r.code), ...verified.rejected_new.map((r) => r.code)]);

  const resolutions = finalizeResolutions({
    all: orders, actionableModel: modelOrders, advisory, deferred, outcome, removal, rolled_back: rolledBack, rollback_reason: verified.rollback_reason,
  });
  for (const r of verified.rolled_back) issues.push({ code: 'enhance_revision_rolled_back', severity: 'warning', test_case_code: r.code, message: `Đã hoàn tác ${r.code}: ${r.reason}` });
  for (const r of verified.rejected_new) issues.push({ code: 'enhance_new_case_rejected', severity: 'warning', test_case_code: r.code, message: `Case mới ${r.code} bị loại: ${r.reason}` });

  const after = estimateScoreAfter({ after_l0: verified.delta.l0_after, semantic_before: semanticBefore, resolutions, total_cases: verified.test_cases.length });
  const { l0_after: _l0After, ...deltaRest } = verified.delta;
  void _l0After;

  const resolvedFingerprints = resolutions.filter((r) => ['FIXED', 'ADDED', 'SPLIT', 'REMOVED'].includes(r.status)).map((r) => r.fingerprint);
  return {
    test_cases: verified.test_cases,
    revised_codes: [...patchedCodes].filter((c) => !rolledBack.has(c)),
    added_codes: [...newCodes].filter((c) => !rolledBack.has(c)),
    removed_codes: [...removedCodes],
    rejected: [...outcome.rejected, ...verified.rejected_new.map((r) => ({ code: r.code, reason: r.reason }))],
    resolutions,
    unresolved: resolutions.filter((r) => r.status === 'UNRESOLVED'),
    deferred: deferred.slice(0, L.maxDeferredReported),
    waivers: buildWaivers(orders, resolutions),
    delta: { ...deltaRest, score_after: after.score, verdict_after: after.verdict },
    work_orders: orders,
    calls,
    truncated,
    models: [...new Set(models)],
    changes: changes.slice(0, L.maxChangeSummaries),
    issues,
    previous_run: { fingerprints: orders.map((o) => o.fingerprint), resolved_fingerprints: resolvedFingerprints },
    plan: { batches: plan.batches.length, batch_tokens: plan.batch_tokens, budget_tokens: input.budget_tokens },
  };
}
