// ============================================================================
// File: src/services/ai/generation-acceptance.ts
// ACCEPTANCE of generated test cases, in code. Review's most frequent findings (see the rule
// histogram / `generator_recommendations`) all have the same root cause: a rule that lives only
// in the Generation prompt is a wish. These levers move them to the point where output is
// accepted, using the SAME implementations Review uses (no second copy to drift):
//
//   Q02/Q03/Q06/Q07  assessCaseDetail          (min steps, placeholders, vague lexicon, final result)
//   Q04               lintTestData             (placeholder / Luhn / date / email / step<->data)
//   Q11               analysis.risk_ranking    (priority derived, not free-form)
//   Q12/Q15           assessMappingEvidence    (empty citations filled, redundant false ones dropped)
//   Q25               contentDuplicateKind     (certain duplicates across batches dropped)
//
// Modes (env GENERATION_ACCEPTANCE; default `repair`):
//   off      nothing (kill switch)
//   repair   deterministic, never costs a model call, never loses a case for quality:
//            Q11 derive, Q12 fill, Q15 drop/report, Q25 drop, quality problems reported as warnings
//   enforce  repair + REJECT cases failing Q02/Q03/Q04/Q06/Q07 (and Q12 for core categories);
//            the orchestrator re-queues the affected categories ONCE; on that final attempt nothing
//            is rejected (`relax`), so work is never lost, only reported. Costs route time budget.
//
// Pure: no env (except getAcceptanceModeFromEnv), no clock, no I/O, no zod.
// ============================================================================

import type { GeneratedTestCase, GenerationAnalysis, TestCaseCategory } from '@/models/validators/test-case';
import type { ParsedDocument } from '@/models/validators/document';
import { assessMappingEvidence, buildTestCaseHaystack } from '@/services/documents/coverage-evidence';
import { collectAtomInventory } from '@/services/documents/coverage';
import { assessCaseDetail } from '@/services/ai/review-analysis';
import { contentDuplicateKind, lintTestData, titleSimilarity, type TestDataIssueKind } from '@/services/ai/review-facts';
import type { SemanticIssue } from '@/services/ai/test-case-validation';

export type AcceptanceMode = 'off' | 'repair' | 'enforce';

export function resolveAcceptanceMode(raw: string | undefined | null): AcceptanceMode {
  const v = (raw ?? '').trim().toLowerCase();
  return v === 'off' || v === 'enforce' ? v : 'repair';
}

export function getAcceptanceModeFromEnv(): AcceptanceMode {
  return resolveAcceptanceMode(process.env.GENERATION_ACCEPTANCE);
}

/** assessCaseDetail reasons that are DEFECTS (the rest — too many steps, prose, repeats — are hygiene Review reports). */
const HARD_DETAIL_REASONS: ReadonlySet<string> = new Set(['too_few_steps', 'placeholder_step', 'vague_wording', 'vague_final_result']);
/** lintTestData kinds that are Major in Review (Minor ones — undeclared Luhn, phone format, unused data — stay Review's). */
const HARD_TEST_DATA_KINDS: ReadonlySet<TestDataIssueKind> = new Set<TestDataIssueKind>([
  'placeholder_value', 'luhn_mismatch', 'invalid_date_undeclared', 'malformed_email', 'value_not_in_test_data',
]);
/** A case in these categories must trace to an atom when atoms exist; cross-cutting ones (security, performance...) may legitimately cite none. */
export const TRACEABILITY_REQUIRED_CATEGORIES: ReadonlySet<TestCaseCategory> = new Set<TestCaseCategory>(['positive', 'negative', 'boundary', 'integration']);
/** Same threshold Review uses to match a case to a risk_ranking scenario. */
export const RISK_MATCH_MIN_SIMILARITY = 0.5;
const PRIORITIES: ReadonlySet<string> = new Set(['Critical', 'Major', 'Normal']);

export type AcceptanceContext = {
  mode: AcceptanceMode;
  detail_level: string;
  language: string;
  /** FULL documents (source of truth for atom ids), not the atom-capped prompt copy. */
  documents: ParsedDocument[];
  analysis: GenerationAnalysis | null;
  /** Everything already accepted in earlier batches / passes. */
  existing: readonly GeneratedTestCase[];
  /** Final attempt: nothing is rejected; hard failures become warnings. Never lose work. */
  relax?: boolean;
};

export type AcceptanceRejection = { test_case_code: string; category: TestCaseCategory; reasons: string[] };

export type AcceptanceResult = {
  accepted: GeneratedTestCase[];
  rejected: AcceptanceRejection[];
  issues: SemanticIssue[];
};

export function acceptGeneratedBatch(candidates: readonly GeneratedTestCase[], ctx: AcceptanceContext): AcceptanceResult {
  if (ctx.mode === 'off') return { accepted: [...candidates], rejected: [], issues: [] };

  const issues: SemanticIssue[] = [];
  const rejected: AcceptanceRejection[] = [];
  const accepted: GeneratedTestCase[] = [];
  const inventory = collectAtomInventory(ctx.documents);
  const hasAtoms = inventory.ordered.length > 0;
  const ranking = ctx.analysis?.risk_ranking ?? [];

  // Which cases really exercise which atom (existing + this batch), to tell a REDUNDANT false citation
  // (atom exercised elsewhere: dropping it cannot lower coverage) from a missing one (kept and reported).
  const exercisedBy = new Map<string, Set<string>>();
  if (hasAtoms) {
    for (const tc of [...ctx.existing, ...candidates]) {
      const hay = buildTestCaseHaystack(tc);
      for (const id of new Set(tc.source_requirement_ids ?? [])) {
        const atom = inventory.byId.get(id);
        if (atom && assessMappingEvidence(atom, tc, hay).has_evidence) exercisedBy.set(id, new Set([...(exercisedBy.get(id) ?? []), tc.code]));
      }
    }
  }

  for (const candidate of candidates) {
    let tc: GeneratedTestCase = { ...candidate };
    const note = (code: SemanticIssue['code'], message: string, atom_id?: string) =>
      issues.push({ code, severity: 'warning', test_case_code: tc.code, message, ...(atom_id ? { atom_id } : {}) });

    // Q25: a scenario nothing distinguishes from one already accepted is dropped, not accumulated.
    const dup = [...ctx.existing, ...accepted].find((c) => contentDuplicateKind(c, tc) !== null);
    if (dup) {
      issues.push({ code: 'duplicate_scenario_dropped', severity: 'warning', test_case_code: tc.code, message: `${tc.code} lặp lại kịch bản ${dup.code} (cùng category, dữ liệu và nội dung) — đã loại bỏ.` });
      continue;
    }

    // Q11: priority comes from the generator's own risk ranking, not from free-form choice per case.
    let best: { target: string; scenario: string; s: number } | null = null;
    for (const r of ranking) {
      const target = String(r.resulting_priority ?? '');
      if (!PRIORITIES.has(target) || !r.scenario) continue;
      const s = titleSimilarity(tc.title, r.scenario);
      if (s >= RISK_MATCH_MIN_SIMILARITY && (!best || s > best.s)) best = { target, scenario: r.scenario, s };
    }
    if (best && best.target !== tc.priority) {
      note('priority_derived', `${tc.code}: priority ${tc.priority} → ${best.target} theo risk_ranking của kịch bản "${best.scenario.slice(0, 60)}".`);
      tc = { ...tc, priority: best.target as GeneratedTestCase['priority'] };
    }

    if (hasAtoms) {
      // Q15: a citation the case does not exercise. Redundant -> dropped. Otherwise kept and REPORTED: the
      // coverage layer already refuses to count it (weak_evidence_mapping), and dropping it would hide that.
      const hay = buildTestCaseHaystack(tc);
      const kept: string[] = [];
      for (const id of new Set(tc.source_requirement_ids ?? [])) {
        const atom = inventory.byId.get(id);
        if (!atom || assessMappingEvidence(atom, tc, hay).has_evidence) { kept.push(id); continue; }
        const elsewhere = [...(exercisedBy.get(id) ?? [])].filter((code) => code !== tc.code);
        if (elsewhere.length > 0) {
          note('citation_dropped', `${tc.code} khai báo cover "${id}" nhưng không kiểm tra nội dung của nó; atom đã được ${elsewhere[0]} kiểm tra thật — đã bỏ trích dẫn thừa.`, id);
        } else {
          kept.push(id);
          note('citation_not_exercised', `${tc.code} khai báo cover "${id}" (${atom.label}) nhưng không kiểm tra nội dung của nó.`, id);
        }
      }
      if (kept.length !== (tc.source_requirement_ids ?? []).length) tc = { ...tc, source_requirement_ids: kept };

      // Q12: an empty citation list when atoms exist. Fill ONLY from evidence-backed matches (the same test coverage uses).
      if ((tc.source_requirement_ids ?? []).length === 0) {
        const matches = inventory.ordered
          .map((atom) => ({ atom, ev: assessMappingEvidence(atom, tc, hay) }))
          .filter((m) => m.ev.has_evidence && m.ev.matched_terms.length > 0)
          .sort((a, b) => b.ev.score - a.ev.score)
          .slice(0, 2);
        if (matches.length > 0) {
          tc = { ...tc, source_requirement_ids: matches.map((m) => m.atom.atom_id) };
          note('traceability_filled', `${tc.code} chưa trích dẫn atom nào — đã gắn ${matches.map((m) => m.atom.atom_id).join(', ')} (khớp nội dung).`);
        } else {
          note('traceability_missing', `${tc.code} không trích dẫn atom nào và không khớp nội dung atom nào dù tài liệu có atom.`);
        }
      }
    }

    // Q02/Q03/Q06/Q07 + Q04: defects Review would flag Major. Same implementations, same verdicts.
    const reasons: string[] = [];
    for (const r of assessCaseDetail(tc, ctx.detail_level, ctx.language).reasons) {
      if (HARD_DETAIL_REASONS.has(r.code)) reasons.push(`${r.rule ?? '?'}:${r.code}`);
    }
    for (const i of lintTestData(tc, ctx.language)) if (HARD_TEST_DATA_KINDS.has(i.kind)) reasons.push(`Q04:${i.kind}`);
    if (hasAtoms && (tc.source_requirement_ids ?? []).length === 0 && TRACEABILITY_REQUIRED_CATEGORIES.has(tc.category)) reasons.push('Q12:no_traceability');

    if (reasons.length > 0) {
      const list = [...new Set(reasons)].join(', ');
      if (ctx.mode === 'enforce' && !ctx.relax) {
        rejected.push({ test_case_code: tc.code, category: tc.category, reasons: [...new Set(reasons)] });
        issues.push({ code: 'acceptance_rejected', severity: 'warning', test_case_code: tc.code, message: `${tc.code} không đạt chuẩn chấp nhận (${list}) — loại khỏi lô, category sẽ được sinh lại một lần.` });
        continue;
      }
      issues.push({
        code: ctx.mode === 'enforce' ? 'acceptance_relaxed' : 'acceptance_quality_warning',
        severity: 'warning',
        test_case_code: tc.code,
        message: ctx.mode === 'enforce'
          ? `${tc.code} vẫn không đạt chuẩn (${list}) sau lần sinh lại — giữ lại để không mất công, Review sẽ đánh dấu.`
          : `${tc.code} có lỗi chất lượng (${list}) — giữ lại; bật GENERATION_ACCEPTANCE=enforce để tự sinh lại.`,
      });
    }
    accepted.push(tc);
  }
  return { accepted, rejected, issues };
}

/**
 * Categories to re-queue after a batch: those that lost a case to rejection and, as a result, fall
 * short of the per-category minimum among what the batch actually contributed.
 */
export function categoriesToRegenerate(
  batch: readonly TestCaseCategory[],
  acceptedFromBatch: readonly GeneratedTestCase[],
  rejected: readonly AcceptanceRejection[],
  perCategoryMin: number,
): TestCaseCategory[] {
  return batch.filter(
    (category) =>
      rejected.some((r) => r.category === category) &&
      acceptedFromBatch.filter((tc) => tc.category === category).length < perCategoryMin,
  );
}
