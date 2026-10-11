// ============================================================================
// File: src/services/ai/enhance-continuation.ts
// Multi-pass Enhance, as pure functions (no env, no clock, no I/O, no React).
//
// One Enhance request is bounded on purpose: <= maxCallsPerRun model calls, <= maxTargetCases per
// call, and a route time budget (maxDuration). A suite with dozens of flagged cases therefore cannot
// be finished in ONE request; the rest comes back as `deferred`. "Enhance everything" is a loop the
// CLIENT drives: each pass is a normal, bounded request with a fresh server budget, run on the output
// of the previous pass, until nothing is left to do.
//
// This module decides, between passes:
//   1. what the next pass must NOT redo   (fixed / declined / rolled-back findings -> exclude + drop)
//   2. what the next pass still owes      (PARTIAL findings are narrowed to the cases not yet applied)
//   3. whether another pass is worth it   (work remains AND the last pass actually changed something)
// so the loop terminates, never re-edits a case that was already fixed, and never replays a finding
// the model deliberately declined.
// ============================================================================

import type { ReviewFindingValue } from '@/models/validators/test-case';
import { computeFingerprint } from '@/services/ai/review-findings';

/** Hard stop for the client loop. Each pass costs up to maxCallsPerRun model calls. */
export const MAX_ENHANCE_ROUNDS = 10;

export type RoundResolution = { fingerprint: string; status: string; test_case_codes: string[] };

/** The slice of an /api/ai/enhance response that the loop needs. */
export type RoundOutcome = {
  resolutions: readonly RoundResolution[];
  revised: readonly string[];
  added: readonly string[];
  removed: readonly string[];
  /** Cases whose findings did not fit this pass (response.deferred_test_cases). */
  deferred_codes: readonly string[];
  /** Model calls the pass made (response.model_calls); 0 means there was nothing to send. */
  model_calls?: number;
};

export type ContinuationState = {
  /** review_result.findings to send with the next pass (resolved ones removed, partial ones narrowed). */
  findings: ReviewFindingValue[];
  /** Fingerprints the next pass must not process again (response -> request.exclude_fingerprints). */
  exclude: string[];
};

/** The finding is finished: the change is in the cases. */
const DONE: ReadonlySet<string> = new Set(['FIXED', 'ADDED', 'SPLIT', 'REMOVED']);
/** The model declined it, it could not be applied, or the revision was reverted: do not replay it. */
const SETTLED_UNRESOLVED: ReadonlySet<string> = new Set(['DECLINED', 'UNRESOLVED', 'ROLLED_BACK']);

export function initialContinuation(findings: readonly ReviewFindingValue[]): ContinuationState {
  return { findings: [...findings], exclude: [] };
}

export function advanceContinuation(state: ContinuationState, round: Pick<RoundOutcome, 'resolutions'>): ContinuationState {
  const exclude = new Set(state.exclude);
  let findings = [...state.findings];

  for (const r of round.resolutions) {
    if (DONE.has(r.status) || SETTLED_UNRESOLVED.has(r.status)) {
      exclude.add(r.fingerprint);
      findings = findings.filter((f) => f.fingerprint !== r.fingerprint);
      continue;
    }
    if (r.status === 'PARTIAL') {
      // r.test_case_codes = the cases this pass DID change. The rest is still owed; do not re-edit the former.
      findings = findings.flatMap((f) => {
        if (f.fingerprint !== r.fingerprint) return [f];
        const remaining = f.test_case_codes.filter((c) => !r.test_case_codes.includes(c));
        if (remaining.length === 0) {
          exclude.add(f.fingerprint);
          return [];
        }
        return [{ ...f, test_case_codes: remaining, fingerprint: computeFingerprint({ rule: f.rule, test_case_codes: remaining, issue: f.issue }) }];
      });
    }
    // DEFERRED / ADVISORY: untouched. Deferred work is exactly what the next pass is for.
  }

  return { findings, exclude: [...exclude] };
}

export function roundMadeProgress(round: RoundOutcome): boolean {
  return round.revised.length + round.added.length + round.removed.length > 0 || round.resolutions.some((r) => DONE.has(r.status));
}

export function hasRemainingWork(round: RoundOutcome): boolean {
  return round.deferred_codes.length > 0 || round.resolutions.some((r) => r.status === 'PARTIAL' || r.status === 'DEFERRED');
}

/** Another pass is worth running only if work remains AND the last pass changed something. */
export function shouldContinue(input: { round: RoundOutcome; roundsDone: number; maxRounds?: number }): boolean {
  if (input.roundsDone >= (input.maxRounds ?? MAX_ENHANCE_ROUNDS)) return false;
  if ((input.round.model_calls ?? 1) === 0) return false;
  return hasRemainingWork(input.round) && roundMadeProgress(input.round);
}
