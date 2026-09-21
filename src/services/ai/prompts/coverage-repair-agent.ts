import type { UncoveredAtom } from '@/services/documents/coverage';
import type { GeneratedTestCase } from '@/models/validators/test-case';
import type { ParsedDocument } from '@/models/validators/document';
import {
  formatDocumentContextForPrompt,
  formatTestCaseIndexForPrompt,
  formatUncoveredAtomsForPrompt,
} from '../source-context';

export type CoverageRepairPromptInput = {
  requirement_description: string;
  documents: ParsedDocument[];
  /** Case da co — de tranh trung kich ban va tiep tuc day ma. */
  existing_test_cases: GeneratedTestCase[];
  /** Atom con thieu trong BATCH nay. */
  uncovered_atoms: UncoveredAtom[];
  /** Con so DETERMINISTIC do ung dung tinh (khong phai AI tu danh gia). */
  covered_atoms: number;
  total_atoms: number;
  coverage_percent: number;
  language: string;
  detail_level: string;
  /** Ma test case tiep theo duoc phep dung, vd "TC_LOGIN_014". */
  next_code_hint: string;
};

/**
 * DOCUMENT COVERAGE REPAIR MODE — prompt cho vong sua chua do phu.
 *
 * Diem khac biet quan trong so voi prompt generation: o day ta KHONG yeu cau
 * Gemini lam lai tu dau. Ta dua cho no (a) dung danh sach atom con thieu, (b)
 * chi muc case da co de khong viet trung, va yeu cau DUY NHAT cac case bo sung.
 * Ket qua se duoc merge o phia ung dung roi tinh lai coverage bang code.
 */
export function buildCoverageRepairPrompt(input: CoverageRepairPromptInput): string {
  return `You are a Principal QA Engineer running a DOCUMENT COVERAGE REPAIR pass on an existing test suite.

══════════════════════════════════════════════════════════════════
DOCUMENT COVERAGE REPAIR MODE
══════════════════════════════════════════════════════════════════

Current coverage (computed deterministically by the application, this number is authoritative — do NOT dispute or restate it):
${input.covered_atoms}/${input.total_atoms} = ${input.coverage_percent}%

A previous generation pass produced valid test cases but LEFT THE DOCUMENT ATOMS BELOW COMPLETELY UNTESTED.
Your ONLY job in this pass is to create the additional test cases required to cover EVERY atom listed below.

══════════════════════════════════════════════════════════════════
UNCOVERED ATOMS IN THIS BATCH (${input.uncovered_atoms.length}) — ALL MUST BE COVERED
══════════════════════════════════════════════════════════════════

${formatUncoveredAtomsForPrompt(input.uncovered_atoms)}

══════════════════════════════════════════════════════════════════
RULES (INVIOLABLE)
══════════════════════════════════════════════════════════════════

• Every uncovered atom_id above MUST appear in the "source_requirement_ids" array of at least one test case you return.
• You MUST NOT invent atom IDs. Use the EXACT atom_id strings above, character for character. Never substitute a label, a description, a shortened form, or an approximation.
• You MUST NOT mark an atom as covered unless the test case you write ACTUALLY VERIFIES that atom's behaviour. A test case that merely mentions the atom does not cover it.
• One test case MAY cover multiple atoms when they genuinely belong to the same test scenario (e.g. a Figma field atom + the FS validation rule that governs that field).
• Create ADDITIONAL, SEPARATE test cases whenever combining atoms would reduce test specificity. Do NOT bundle unrelated atoms into a generic "verify document requirements" case — such a case will be REJECTED by the application's validator. A single test case may claim at most 8 atoms.
• Do NOT re-output, modify, duplicate, or delete the existing test cases listed below. Return ONLY the NEW cases.
• Maintain sequential test-case codes. The next available code is ${input.next_code_hint}. Follow the TC_{MODULE}_{NNN} convention already used by the suite.
• Use detailed, ATOMIC test steps — exactly ONE action per step, each with its own observable expected_result.
• Include the exact UI labels, field names, placeholder text, states, business rules and expected results as written in the document. Do not paraphrase design wording.
• Include negative, boundary, integration and state-transition coverage where the atom type justifies it.

══════════════════════════════════════════════════════════════════
TEST DESIGN RULES BY ATOM TYPE
══════════════════════════════════════════════════════════════════

• screen_element / field (Figma, UI mockup): verify visibility, exact label text, placeholder, enabled/disabled state, input behaviour, validation message, interaction and navigation. Quote the literal design wording in expected_result.
• rule / condition (FS, business rule): cover happy path, invalid input, boundary, rule violation, alternate path and error handling.
• entity_field (ERD column): derive cases from the constraint — NOT NULL → empty-value negative case; UNIQUE → duplicate-value case; FOREIGN KEY → orphan-reference case; length constraint → min/max/boundary cases; type constraint → invalid-format case.
• relationship (ERD): verify create/update/delete of the relationship plus cascade, restrict, orphan and referential-integrity behaviour that the document actually implies.
• flow_step / state (diagram): give EACH state, transition, decision branch, retry, timeout and failure route its OWN test case. Do not collapse branches into one case.

══════════════════════════════════════════════════════════════════
SOURCE DOCUMENTS (full context — atom IDs above come from here)
══════════════════════════════════════════════════════════════════

${formatDocumentContextForPrompt(input.documents)}

══════════════════════════════════════════════════════════════════
REQUIREMENT DESCRIPTION
══════════════════════════════════════════════════════════════════

${input.requirement_description || '(empty — derive everything from the documents above)'}

══════════════════════════════════════════════════════════════════
EXISTING TEST CASES (index only — do NOT repeat these scenarios, do NOT return them)
══════════════════════════════════════════════════════════════════

${formatTestCaseIndexForPrompt(input.existing_test_cases)}

══════════════════════════════════════════════════════════════════
OUTPUT FORMAT
══════════════════════════════════════════════════════════════════

Return a pure JSON object with a single key "test_cases" containing ONLY the newly created cases:

{
  "test_cases": [
    {
      "code": "TC_XXX_NNN",
      "title": "string — states the exact condition being verified",
      "category": "positive | negative | boundary | ui_ux | compatibility | performance | security | integration | regression | accessibility | localization",
      "priority": "Critical | Major | Normal",
      "preconditions": ["user role, account state, system state, required records, permissions, configuration"],
      "test_data": { "field_name": "concrete realistic value as a string" },
      "steps": [
        { "step_number": 1, "action": "ONE atomic action naming a concrete field/button/screen", "expected_result": "observable result at exactly this point" }
      ],
      "final_expected_result": "end state of system, DB, UI, logs and side effects",
      "source_requirement_ids": ["EXACT atom_id values from the uncovered list above"]
    }
  ]
}

Language for all human-readable values: ${input.language}. Detail level: ${input.detail_level}.
No markdown. No explanation outside the JSON object.`;
}
