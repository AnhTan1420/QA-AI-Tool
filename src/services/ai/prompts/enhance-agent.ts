import type { TestCaseCategory } from '@/models/validators/test-case';
import type { ParsedDocument } from '@/models/validators/document';
import type { EnhancePlan } from '../enhance-merge';
import { ENHANCE_LIMITS, renderQualityStandardsForPrompt } from '../quality-standards';
import { truncate } from '../review-analysis';

// ============================================================================
// Enhance = TARGETED improvement of existing test cases.
//
//   Runs on AI_MODEL_ENHANCE — a separate model chain from Review.
//   Receives: source requirement + the specific cases with findings + those
//             findings (structured). NOT the whole suite, NOT Review's full
//             response, NOT any earlier reasoning.
//   Returns:  only the revised (and, for proven taxonomy gaps, new) cases.
//             The application merges them and enforces the boundaries
//             (services/ai/enhance-merge.ts), so the rules below are backed by
//             code, not just by the prompt.
// ============================================================================

export const ENHANCE_SYSTEM_PROMPT = `You are improving an existing QA test case.

Use the SAME quality standard used by the Generate workflow (given in the user message).

Use the supplied Review findings as targeted guidance.

Improve only where justified by source requirements and review findings.

Rules:
- Preserve valid behavior: keep each case's code, category, priority and scenario. Fix its quality, not its purpose.
- Do not invent unsupported requirements. Every value, rule and expected result must come from the source requirement or the case itself.
- Do not add unrelated scenarios. New cases are allowed ONLY for the listed taxonomy gaps, up to the stated limit.
- Do not return cases that have no finding.
- Split merged steps, replace generic wording with the concrete field/button/value from test_data, make expected results observable. Trim repetition and prose when a case is over-detailed. Do not pad.
- Do not provide lengthy reasoning. Return only the required structure.
- All JSON keys stay in English; text values keep the language of the original test cases.`;

export type EnhancePromptInput = {
  requirement_description: string;
  detail_level: string;
  required_categories: readonly TestCaseCategory[];
  per_category_min: number;
  plan: EnhancePlan;
  /** Titles of the whole suite, only used to avoid duplicating a scenario when adding gap cases. */
  suite_index: { code: string; title: string; category: TestCaseCategory }[];
  /** Grounding for new gap cases only. */
  documents: ParsedDocument[];
};

const MAX_REQUIREMENT_CHARS = 6_000;
const MAX_INDEX_LINES = 60;
const MAX_ATOMS = 20;

function formatTargets(plan: EnhancePlan): string {
  if (plan.targets.length === 0) return '(none — only taxonomy gaps below)';
  return plan.targets
    .map((tc) => {
      const notes = (plan.findings.get(tc.code) ?? []).map((n) => `    - ${n}`).join('\n');
      return `### ${tc.code}
FINDINGS:
${notes}
CURRENT CASE:
${JSON.stringify(tc)}`;
    })
    .join('\n\n');
}

function formatGaps(plan: EnhancePlan): string {
  if (plan.taxonomy_gaps.length === 0) return '(none — do NOT add any new test case)';
  return plan.taxonomy_gaps
    .map(
      (g) =>
        `- ${g.category}: ${g.status}. ${g.evidence} Existing: ${g.existing_codes.join(', ') || '(none)'}. You may add at most ${g.allowed_new} new case(s) with category "${g.category}".`,
    )
    .join('\n');
}

function formatGrounding(documents: ParsedDocument[]): string {
  const atoms = documents.flatMap((d) => d.atoms).slice(0, MAX_ATOMS);
  if (atoms.length === 0) return '';
  return `\n[SOURCE DOCUMENT ATOMS — grounding for new cases only; cite an id in source_requirement_ids only if it is listed here]\n${atoms
    .map((a) => `  [${a.atom_id}] ${truncate(a.label, 70)} — ${truncate(a.detail, 110)}`)
    .join('\n')}`;
}

export function buildEnhancePrompt(input: EnhancePromptInput): string {
  const { plan } = input;
  const allowNew = plan.taxonomy_gaps.length > 0;
  const index = allowNew
    ? `\n[EXISTING SCENARIOS — do not duplicate]\n${input.suite_index
        .slice(0, MAX_INDEX_LINES)
        .map((c) => `  ${c.code} [${c.category}] ${truncate(c.title, 80)}`)
        .join('\n')}`
    : '';

  return `${renderQualityStandardsForPrompt({
    detailLevel: input.detail_level,
    requiredCategories: input.required_categories,
    perCategoryMin: input.per_category_min,
  })}

[SOURCE REQUIREMENT]
${truncate(input.requirement_description, MAX_REQUIREMENT_CHARS)}${formatGrounding(input.documents)}

[TEST CASES TO IMPROVE — return a revised version of each, same code]
${formatTargets(plan)}

[TAXONOMY GAPS — the only reason a new case may be added]
${formatGaps(plan)}${index}

OUTPUT (JSON object, exactly these keys):
{
  "test_cases": [ <full test case object, same schema as the current cases> ],
  "changes": [ "<=${ENHANCE_LIMITS.maxChangeSummaryChars} chars: TC_X — what you improved" ]
}
Return ONLY revised target cases and allowed new cases. "changes" has at most ${ENHANCE_LIMITS.maxChangeSummaries} entries. Steps are numbered 1..n.`;
}
