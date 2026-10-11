import { describe, expect, it } from 'vitest';
import type { ReviewFindingValue } from '@/models/validators/test-case';
import { computeFingerprint } from '@/services/ai/review-findings';
import {
  MAX_ENHANCE_ROUNDS,
  advanceContinuation,
  hasRemainingWork,
  initialContinuation,
  roundMadeProgress,
  shouldContinue,
  type RoundOutcome,
} from '@/services/ai/enhance-continuation';

const finding = (n: number, codes: string[], over: Partial<ReviewFindingValue> = {}): ReviewFindingValue => {
  const base = {
    rule: 'Q03' as const, kind: 'defect' as const, severity: 'Major' as const, confidence: 'High' as const,
    action: 'FIX' as const, scope: 'case' as const, test_case_codes: codes, fields_affected: ['steps' as const],
    issue: `generic wording variant${n}`, evidence: 'e', enhance_instruction: 'fix', origin: 'semantic' as const,
    finding_id: `F-00${n}`, ...over,
  };
  return { ...base, fingerprint: computeFingerprint(base) };
};
const round = (over: Partial<RoundOutcome> = {}): RoundOutcome => ({ resolutions: [], revised: [], added: [], removed: [], deferred_codes: [], model_calls: 2, ...over });

describe('advanceContinuation — what the next pass must not redo', () => {
  const f1 = finding(1, ['TC_1', 'TC_2']);
  const f2 = finding(2, ['TC_3']);
  const f3 = finding(3, ['TC_4']);
  const f4 = finding(4, ['TC_5']);

  it('drops and excludes FIXED / DECLINED / UNRESOLVED / ROLLED_BACK findings, keeps DEFERRED ones', () => {
    const next = advanceContinuation(initialContinuation([f1, f2, f3, f4]), round({
      resolutions: [
        { fingerprint: f1.fingerprint, status: 'FIXED', test_case_codes: ['TC_1', 'TC_2'] },
        { fingerprint: f2.fingerprint, status: 'DECLINED', test_case_codes: ['TC_3'] },
        { fingerprint: f3.fingerprint, status: 'ROLLED_BACK', test_case_codes: ['TC_4'] },
        { fingerprint: f4.fingerprint, status: 'DEFERRED', test_case_codes: ['TC_5'] },
      ],
    }));
    expect(next.findings.map((f) => f.finding_id)).toEqual([f4.finding_id]);
    expect(new Set(next.exclude)).toEqual(new Set([f1.fingerprint, f2.fingerprint, f3.fingerprint]));
  });

  it('narrows a PARTIAL finding to the cases not yet changed, with a fresh fingerprint (no re-edit of fixed cases)', () => {
    const next = advanceContinuation(initialContinuation([f1]), round({
      resolutions: [{ fingerprint: f1.fingerprint, status: 'PARTIAL', test_case_codes: ['TC_1'] }],
    }));
    expect(next.findings).toHaveLength(1);
    expect(next.findings[0].test_case_codes).toEqual(['TC_2']);
    expect(next.findings[0].fingerprint).toBe(computeFingerprint({ rule: 'Q03', test_case_codes: ['TC_2'], issue: f1.issue }));
    expect(next.findings[0].fingerprint).not.toBe(f1.fingerprint);
    expect(next.exclude).not.toContain(f1.fingerprint); // still owed, so it must stay selectable
  });

  it('a PARTIAL whose every case was in fact applied is finished', () => {
    const next = advanceContinuation(initialContinuation([f1]), round({
      resolutions: [{ fingerprint: f1.fingerprint, status: 'PARTIAL', test_case_codes: ['TC_1', 'TC_2'] }],
    }));
    expect(next.findings).toEqual([]);
    expect(next.exclude).toContain(f1.fingerprint);
  });

  it('accumulates across passes and ignores ADVISORY / resolutions for findings it does not hold (mechanical)', () => {
    const s1 = advanceContinuation(initialContinuation([f1, f2]), round({ resolutions: [{ fingerprint: f1.fingerprint, status: 'FIXED', test_case_codes: ['TC_1'] }] }));
    const s2 = advanceContinuation(s1, round({
      resolutions: [
        { fingerprint: f2.fingerprint, status: 'FIXED', test_case_codes: ['TC_3'] },
        { fingerprint: 'mechanical-fp', status: 'FIXED', test_case_codes: ['TC_9'] },
        { fingerprint: 'advisory-fp', status: 'ADVISORY', test_case_codes: [] },
      ],
    }));
    expect(s2.findings).toEqual([]);
    expect(new Set(s2.exclude)).toEqual(new Set([f1.fingerprint, f2.fingerprint, 'mechanical-fp']));
  });
});

describe('shouldContinue — terminates, and only while it pays off', () => {
  const deferred = round({ deferred_codes: ['TC_7'], revised: ['TC_1'] });

  it('continues while work remains and the last pass changed something', () => {
    expect(shouldContinue({ round: deferred, roundsDone: 1 })).toBe(true);
    expect(shouldContinue({ round: round({ resolutions: [{ fingerprint: 'x', status: 'PARTIAL', test_case_codes: ['A'] }], revised: ['A'] }), roundsDone: 1 })).toBe(true);
  });
  it('stops when nothing is left', () => {
    expect(hasRemainingWork(round({ revised: ['TC_1'] }))).toBe(false);
    expect(shouldContinue({ round: round({ revised: ['TC_1'] }), roundsDone: 1 })).toBe(false);
  });
  it('stops when a pass made no progress (a deferred case that can never fit must not loop forever)', () => {
    const stuck = round({ deferred_codes: ['TC_HUGE'], resolutions: [{ fingerprint: 'x', status: 'DEFERRED', test_case_codes: ['TC_HUGE'] }] });
    expect(roundMadeProgress(stuck)).toBe(false);
    expect(shouldContinue({ round: stuck, roundsDone: 1 })).toBe(false);
  });
  it('stops when the pass sent no model call at all', () => {
    expect(shouldContinue({ round: { ...deferred, model_calls: 0 }, roundsDone: 1 })).toBe(false);
  });
  it('stops at the hard cap', () => {
    expect(shouldContinue({ round: deferred, roundsDone: MAX_ENHANCE_ROUNDS })).toBe(false);
    expect(shouldContinue({ round: deferred, roundsDone: 2, maxRounds: 2 })).toBe(false);
  });
});
