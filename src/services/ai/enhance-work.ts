// ============================================================================
// File: src/services/ai/enhance-work.ts
// Review findings ARE the Enhance work order. This file is the deterministic front half:
//
//   buildWorkOrders()  fresh mechanical findings (recomputed here, never trusted from the
//                      client) + the client's semantic findings (re-clamped, never trusted)
//   selectWorkOrders() what is actionable now vs advisory (severity floor, confidence,
//                      kind, MERGE, user selection)
//   planBatches()      pack the work into calls that fit the output ceiling (24/9 protection);
//                      whatever does not fit is reported as `deferred`, never truncated
//
// Pure: no env, no clock, no I/O, no zod.
// ============================================================================

import type { GeneratedTestCase } from '@/models/validators/test-case';
import { TOKENS_PER_CASE } from '@/services/ai/output-budget';
import { ENHANCE_LIMITS, normalizeDetailLevel } from '@/services/ai/quality-standards';
import {
  assignIds,
  clampSemanticFindings,
  type CaseField,
  type ClampContext,
  type FindingSeverity,
  type RawFinding,
  type ReviewFinding,
} from '@/services/ai/review-findings';

export const ENHANCE_PROMPT_VERSION = 'enhance-2.0.0';
export const ENHANCE_LEGACY_PROMPT_VERSION = 'enhance-1.0.0';

export type WorkOrder = ReviewFinding;

/** Statuses the MODEL may claim. */
export const MODEL_RESOLUTION_STATUSES = ['FIXED', 'ADDED', 'SPLIT', 'PARTIAL', 'DECLINED'] as const;
export type ModelResolutionStatus = (typeof MODEL_RESOLUTION_STATUSES)[number];
/** Final statuses; the application assigns the ones the model cannot (and downgrades false claims). */
export type ResolutionStatus = ModelResolutionStatus | 'REMOVED' | 'ADVISORY' | 'UNRESOLVED' | 'ROLLED_BACK' | 'DEFERRED';

export type PatchSet = {
  title?: string;
  preconditions?: string[];
  /** Replaces the WHOLE test_data of the case (list form because Gemini schemas cannot express dynamic keys). */
  test_data_entries?: { field: string; value: string }[];
  steps?: { step_number: number; action: string; expected_result: string }[];
  final_expected_result?: string;
  priority?: string;
  category?: string;
  source_requirement_ids?: string[];
};

export type EnhanceWorkOutput = {
  patches: { code: string; set: PatchSet }[];
  new_cases: { finding_id: string; test_case: GeneratedTestCase }[];
  resolutions: { finding_id: string; status: ModelResolutionStatus; test_case_codes: string[]; note: string }[];
  changes: string[];
};

export type FinalResolution = {
  finding_id: string;
  fingerprint: string;
  rule: string;
  status: ResolutionStatus;
  /** Cases the resolution ended up touching (patched codes, allocated new codes, removed code). */
  test_case_codes: string[];
  note: string;
};

// ── Build & select ─────────────────────────────────────────────────────────

/**
 * Union of fresh mechanical findings and re-clamped client semantic findings, ids re-assigned.
 * `clientSemantic` is whatever the client posted as review_result.findings with origin 'semantic'.
 */
export function buildWorkOrders(input: {
  mechanical: RawFinding[];
  clientFindings: readonly ReviewFinding[];
  clamp: ClampContext;
}): { orders: WorkOrder[]; dropped: { reason: string }[] } {
  const semanticRaw = input.clientFindings.filter((f) => f.origin === 'semantic');
  const { kept, dropped } = clampSemanticFindings(semanticRaw, input.clamp);
  const orders = assignIds([
    ...input.mechanical.map((finding) => ({ finding, origin: 'mechanical' as const })),
    ...kept.map((finding) => ({ finding, origin: 'semantic' as const })),
  ]);
  return { orders, dropped };
}

const SEV_RANK: Record<FindingSeverity, number> = { Critical: 0, Major: 1, Minor: 2 };

export type SelectionOptions = {
  /** User-chosen findings (by fingerprint: ids are re-assigned per run). Overrides the defaults. */
  selected_fingerprints?: readonly string[];
  /** Default 'Major': Critical and Major are applied, Minor stays advisory. */
  min_severity?: FindingSeverity;
};

export type Advisory = { order: WorkOrder; reason: string };

export function selectWorkOrders(orders: readonly WorkOrder[], options: SelectionOptions = {}): { actionable: WorkOrder[]; advisory: Advisory[] } {
  const floor = SEV_RANK[options.min_severity ?? 'Major'];
  const picked = options.selected_fingerprints ? new Set(options.selected_fingerprints) : null;
  const actionable: WorkOrder[] = [];
  const advisory: Advisory[] = [];
  for (const o of orders) {
    if (o.kind === 'question') { advisory.push({ order: o, reason: 'question: needs the requirement owner' }); continue; }
    if (o.action === 'MERGE') { advisory.push({ order: o, reason: 'MERGE is advisory: cases cannot be combined safely in code' }); continue; }
    if (picked) {
      if (!picked.has(o.fingerprint)) advisory.push({ order: o, reason: 'not selected' });
      else actionable.push(o);
      continue;
    }
    if (o.confidence === 'Low') { advisory.push({ order: o, reason: 'low confidence: shown, not applied by default' }); continue; }
    if (SEV_RANK[o.severity] > floor) { advisory.push({ order: o, reason: `below the ${options.min_severity ?? 'Major'} severity floor` }); continue; }
    actionable.push(o);
  }
  actionable.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  return { actionable, advisory };
}

/** REMOVE is executed by the application; everything else needs the model. */
export function splitByExecutor(orders: readonly WorkOrder[]): { model: WorkOrder[]; removals: WorkOrder[] } {
  return {
    model: orders.filter((o) => o.action !== 'REMOVE'),
    removals: orders.filter((o) => o.action === 'REMOVE'),
  };
}

/** Fields the model may set per case = union of fields_affected of the model-handled orders targeting it. */
export function allowedFieldsByCode(orders: readonly WorkOrder[]): Map<string, Set<CaseField>> {
  const out = new Map<string, Set<CaseField>>();
  for (const o of orders) {
    if (o.action !== 'FIX' && o.action !== 'RECLASSIFY' && o.action !== 'SPLIT') continue;
    for (const code of o.test_case_codes) {
      const set = out.get(code) ?? new Set<CaseField>();
      for (const f of o.fields_affected) {
        // category/priority only travel with RECLASSIFY (clamp enforces it upstream; defence in depth).
        if ((f === 'category' || f === 'priority') && o.action !== 'RECLASSIFY') continue;
        set.add(f);
      }
      if (o.action === 'SPLIT') set.add('steps');
      out.set(code, set);
    }
  }
  return out;
}

/**
 * Cases whose source_requirement_ids may be REPLACED instead of only extended: a Q15 (cited but not
 * exercised) or Q12 (nonexistent id) finding is, by definition, a request to REMOVE a citation.
 * Everywhere else ids are preserved or extended, never dropped. The atom-coverage non-regression
 * guard in verifyMerge still backstops a removal that would cost coverage.
 */
export function idsReplaceCodes(orders: readonly WorkOrder[]): Set<string> {
  const out = new Set<string>();
  for (const o of orders) {
    if (o.action !== 'FIX' || !o.fields_affected.includes('source_requirement_ids')) continue;
    if (o.rule === 'Q15' || o.rule === 'Q12') o.test_case_codes.forEach((c) => out.add(c));
  }
  return out;
}

// ── Budget planner (24/9 protection) ───────────────────────────────────────

export type BatchItem = {
  order: WorkOrder;
  /** Cases of THIS call (a cluster may be spread over several calls). Empty for ADD. */
  codes: string[];
};

export type Deferred = { finding_id: string; fingerprint: string; rule: string; codes: string[]; reason: string };

function jsonChars(value: unknown): number {
  return JSON.stringify(value ?? '').length;
}

/** Output tokens a patch for these fields of `tc` will cost (conservative: +15% growth, floor for step splits). */
export function estimatePatchTokens(tc: GeneratedTestCase, fields: Iterable<CaseField>, detailLevel: string): number {
  let chars = 0;
  for (const f of fields) {
    const value =
      f === 'test_data'
        ? Object.entries(tc.test_data ?? {}).map(([field, value]) => ({ field, value }))
        : (tc as unknown as Record<string, unknown>)[f];
    chars += jsonChars(value) + 12;
  }
  let tokens = Math.ceil((chars * 1.15) / ENHANCE_LIMITS.charsPerToken) + 12;
  if ([...fields].includes('steps')) {
    // A step split GROWS the field; never plan below 60% of a typical full case.
    tokens = Math.max(tokens, Math.ceil(TOKENS_PER_CASE[normalizeDetailLevel(detailLevel)] * 0.6));
  }
  return tokens + 24;
}

function newCaseTokens(detailLevel: string, count: number): number {
  return TOKENS_PER_CASE[normalizeDetailLevel(detailLevel)] * count;
}

export type PlanResult = {
  batches: BatchItem[][];
  deferred: Deferred[];
  /** Estimated visible output tokens per batch (what the planner packed to). */
  batch_tokens: number[];
};

/**
 * Pack model-handled work into calls whose estimated output fits `budgetTokens`
 * (callers pass safeOutputTokens(getEnhanceMaxOutputTokens())). Severity order is preserved:
 * the most severe work goes into the first call. A cluster finding is split by case across
 * calls. Work that does not fit goes to `deferred` — it is NEVER squeezed into an oversized call.
 */
export function planBatches(input: {
  orders: readonly WorkOrder[];
  cases: readonly GeneratedTestCase[];
  detail_level: string;
  budget_tokens: number;
  max_calls: number;
}): PlanResult {
  const L = ENHANCE_LIMITS;
  const byCode = new Map(input.cases.map((c) => [c.code, c]));
  const capacity = Math.max(200, input.budget_tokens - L.callOverheadTokens);

  type Unit = { order: WorkOrder; code: string | null; tokens: number; newCases: number };
  const units: Unit[] = [];
  const deferred: Deferred[] = [];
  let newCaseBudget: number = L.maxNewCasesPerRun;

  const defer = (o: WorkOrder, codes: string[], reason: string) =>
    deferred.push({ finding_id: o.finding_id, fingerprint: o.fingerprint, rule: o.rule, codes, reason });

  for (const o of input.orders) {
    if (o.action === 'ADD') {
      if (newCaseBudget <= 0) { defer(o, [], 'new_case_cap_per_run'); continue; }
      newCaseBudget -= 1;
      units.push({ order: o, code: null, tokens: newCaseTokens(input.detail_level, 1) + L.tokensPerResolution, newCases: 1 });
      continue;
    }
    const codes = o.test_case_codes.filter((c) => byCode.has(c));
    for (const code of codes) {
      const tc = byCode.get(code)!;
      const fields = o.action === 'SPLIT' ? new Set<CaseField>(['steps', ...o.fields_affected]) : new Set(o.fields_affected);
      let tokens = estimatePatchTokens(tc, fields, input.detail_level) + L.tokensPerResolution;
      let newCases = 0;
      if (o.action === 'SPLIT') {
        if (newCaseBudget <= 0) { defer(o, [code], 'new_case_cap_per_run'); continue; }
        newCases = Math.min(L.maxNewCasesPerSplit, newCaseBudget);
        newCaseBudget -= newCases;
        tokens += newCaseTokens(input.detail_level, newCases);
      }
      units.push({ order: o, code, tokens, newCases });
    }
  }

  const batches: BatchItem[][] = [];
  const batchTokens: number[] = [];
  let current: Unit[] = [];
  let used = 0;
  const flush = () => {
    if (current.length === 0) return;
    const items = new Map<string, BatchItem>();
    for (const u of current) {
      const item = items.get(u.order.finding_id) ?? { order: u.order, codes: [] };
      if (u.code) item.codes.push(u.code);
      items.set(u.order.finding_id, item);
    }
    batches.push([...items.values()]);
    batchTokens.push(used);
    current = [];
    used = 0;
  };

  for (const u of units) {
    if (u.tokens > capacity) {
      defer(u.order, u.code ? [u.code] : [], 'exceeds_single_call_budget');
      continue;
    }
    const findingsInBatch = new Set(current.map((x) => x.order.finding_id));
    const wouldBeTargets = new Set(current.filter((x) => x.code).map((x) => x.code));
    if (u.code) wouldBeTargets.add(u.code);
    const overflow =
      used + u.tokens > capacity ||
      (!findingsInBatch.has(u.order.finding_id) && findingsInBatch.size >= L.maxFindingsPerCall) ||
      wouldBeTargets.size > L.maxTargetCases;
    if (overflow) flush();
    if (batches.length >= input.max_calls) {
      defer(u.order, u.code ? [u.code] : [], 'over_call_budget');
      continue;
    }
    current.push(u);
    used += u.tokens;
  }
  flush();
  // A flush above may have produced a batch past max_calls only through the last flush; trim defensively.
  while (batches.length > input.max_calls) {
    const extra = batches.pop()!;
    batchTokens.pop();
    for (const item of extra) defer(item.order, item.codes, 'over_call_budget');
  }
  return { batches, deferred: mergeDeferred(deferred), batch_tokens: batchTokens };
}

/** One entry per (finding, reason), codes merged: the UI shows a short list, not one row per case. */
function mergeDeferred(list: Deferred[]): Deferred[] {
  const map = new Map<string, Deferred>();
  for (const d of list) {
    const key = `${d.finding_id}|${d.reason}`;
    const e = map.get(key);
    if (e) e.codes = [...new Set([...e.codes, ...d.codes])];
    else map.set(key, { ...d, codes: [...d.codes] });
  }
  return [...map.values()].slice(0, ENHANCE_LIMITS.maxDeferredReported);
}
