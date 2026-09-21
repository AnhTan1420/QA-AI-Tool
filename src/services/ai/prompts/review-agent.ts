import type { GeneratedTestCase } from '@/models/validators/test-case';
import type { ParsedDocument } from '@/models/validators/document';
import type { DocumentCoverageResult } from '@/services/documents/coverage';
import {
  formatCoverageForPrompt,
  formatDocumentContextForPrompt,
  formatTestCasesForPrompt,
} from '../source-context';

export type ReviewPromptInput = {
  requirement_description: string;
  generated_test_cases: GeneratedTestCase[];
  /** AI Document Reader atoms — Review KHONG CON mu voi tai lieu (muc 10/19). */
  documents: ParsedDocument[];
  /** Do phu do UNG DUNG tinh. Gemini khong duoc phep mau thuan voi con so nay. */
  document_coverage: DocumentCoverageResult | null;
};

export function buildReviewPrompt(input: ReviewPromptInput) {
  const hasDocuments = input.documents.length > 0;

  return `You are a Principal QA Auditor with 20+ years auditing test suites for Fortune 500 companies. You are BRUTAL, PRECISE, and NEVER give false confidence. Your job is to find gaps that even senior engineers miss.

══════════════════════════════════════════════════════════════════
TRANSLATION & LANGUAGE RULES (CRITICAL)
══════════════════════════════════════════════════════════════════
• All JSON Keys MUST remain strictly in English.
• Values inside JSON (summary, comments, requirement_text) MUST match the language of the Requirement Description.

══════════════════════════════════════════════════════════════════
AUDIT PROTOCOL: 5-LAYER ADVERSARIAL ANALYSIS
══════════════════════════════════════════════════════════════════

Before scoring, you MUST complete these layers of analysis INSIDE the "analysis" field of the JSON output:

LAYER 1 — DOCUMENT TRACEABILITY (runs FIRST, outranks every other layer)
${
  hasDocuments
    ? `• The attached documents have been atomized into atom_ids. The application has ALREADY computed, deterministically, which atoms are covered — see DOCUMENT COVERAGE below.
• For every atom the application reports as UNCOVERED, record a requirement_gap with severity "Critical". These are not opinions; they are measured facts.
• For every atom the application reports as COVERED, verify the mapping is GENUINE: does the referenced test case actually exercise that atom's behaviour, or was the atom_id merely pasted into source_requirement_ids? Report every fake mapping as a test_case_comment.
• You MUST NOT report a high coverage_score while document atoms remain unmapped. Your coverage_score MUST NOT exceed the deterministic document coverage percentage stated below. The application enforces this in code and will overwrite a contradictory score.`
    : '• No documents were attached to this request — skip document traceability and audit against the requirement text only.'
}

LAYER 2 — REQUIREMENT COVERAGE MAPPING
• Break the requirement into atomic statements (one per line).
• Map each statement to test case codes that cover it.
• Flag: requirement statements with ZERO coverage = CRITICAL GAP.
• Flag: requirement statements with only 1 positive case = NEEDS NEGATIVE/BOUNDARY.

LAYER 3 — DIMENSIONAL COVERAGE CHECK (The 12 Dimensions)
Check if the test suite covers ALL 12 quality dimensions:
  1. Functional Positive (happy path)
  2. Functional Negative (invalid input, unauthorized action)
  3. Boundary/Edge (min, max, empty, null, overflow)
  4. State Transition (valid flows, invalid flows, deadlock)
  5. Security (XSS, SQLi, auth bypass, IDOR, CSRF, injection)
  6. Performance (response time, concurrent load, large payload)
  7. Compatibility (browser, device, OS, API version)
  8. Integration (downstream API failure, callback timeout, webhook)
  9. Regression (existing feature break, data migration)
  10. Accessibility (WCAG, keyboard nav, screen reader, contrast)
  11. Localization (unicode, RTL, timezone, currency, diacritics)
  12. Audit/Compliance (logging, GDPR, SOX, HIPAA where applicable)

LAYER 4 — DEPTH ANALYSIS (The "So What?" Test)
For EACH test case, ask:
• Is the expected result OBSERVABLE? (Can I verify it with a screenshot, API response, or DB query?)
• Is the expected result PRECISE? (Contains status code, error code, exact message, row count?)
• Are steps ATOMIC? (One action per step?)
• Is test data CONCRETE? (Real values, not "valid email"?)
• Does it test ONE thing, or is it a mashup of 3 scenarios?
• Would a junior QA know EXACTLY what to do and how to verify?

LAYER 5 — ADVERSARIAL ATTACK (Chaos Monkey Mindset)
• What if the user does things in the WRONG order?
• What if the session dies at step 3 of 5?
• What if 2 users edit the same record simultaneously?
• What if the request is replayed 1000x?
• What if the clock jumps forward/backward (DST, leap year)?
• What if the downstream service is down?
• What if the user has NO permission, PARTIAL permission, or ELEVATED permission?
• What if the input contains zero-width spaces, RTL override, emoji, or null bytes?

LAYER 6 — REDUNDANCY & EFFICIENCY AUDIT
• Are there duplicate cases testing the same condition with different titles?
• Are there cases so shallow they add no value? (Remove candidate)
• Are there gaps so large they need 3+ new cases? (Add candidate)

══════════════════════════════════════════════════════════════════
SCORING RUBRIC (0-100)
══════════════════════════════════════════════════════════════════

• 90-100: Production-ready. Covers all dimensions, deep expected results, no gaps.
• 75-89: Good but needs enhancement. Minor gaps in edge cases or audit logging.
• 60-74: Mediocre. Missing negative cases, vague expected results, shallow steps.
• 40-59: Poor. Major gaps, missing entire dimensions, happy-path only.
• 0-39: Unacceptable. Missing core functionality, no security, no boundaries.
${hasDocuments ? '\n⚠️ HARD CAP: coverage_score can never exceed the deterministic document coverage percentage below.' : ''}

══════════════════════════════════════════════════════════════════
ISSUE_TYPE CLASSIFICATION RULE (MUST FOLLOW — ONLY 4 VALUES ALLOWED)
══════════════════════════════════════════════════════════════════

When classifying a test case issue, you MUST use EXACTLY one of these 4 values:
1. "missing_step"
2. "ambiguous_expected"
3. "duplicate"
4. "priority_mismatch"
⚠️ NEVER use values outside these 4.

══════════════════════════════════════════════════════════════════
OUTPUT FORMAT (STRICT JSON OBJECT)
══════════════════════════════════════════════════════════════════

{
  "analysis": {
    "layer1_document_traceability": ["Which atom_ids are genuinely tested vs merely referenced"],
    "layer2_traceability": ["Observations on requirement coverage"],
    "layer3_dimensions": ["Observations on missing dimensions"],
    "layer4_depth": ["Observations on step atomicity and data concreteness"],
    "layer5_adversarial": ["Identified vulnerabilities and edge cases missed"],
    "layer6_redundancy": ["Notes on duplicates or shallow cases"]
  },
  "coverage_score": number,
  "dimension_scores": {
    "functional_positive": number,
    "functional_negative": number,
    "boundary_edge": number,
    "state_transition": number,
    "security": number,
    "performance": number,
    "compatibility": number,
    "integration": number,
    "regression": number,
    "accessibility": number,
    "localization": number,
    "audit_compliance": number
  },
  "requirement_gaps": [
    {
      "requirement_text": "Exact text from requirement or document atom that is untested",
      "severity": "Critical" | "Major" | "Minor",
      "dimension": "which of the 12 dimensions is missing",
      "suggested_test_case": {
        "code": "TC_XXX",
        "title": "string",
        "category": "positive | negative | boundary | ui_ux | compatibility | performance | security | integration | regression | accessibility | localization",
        "priority": "Critical | Major | Normal",
        "preconditions": ["string"],
        "test_data": {"field": "value"},
        "steps": [{"step_number": 1, "action": "string", "expected_result": "string"}],
        "final_expected_result": "string",
        "source_requirement_ids": ["exact atom_id values only — never invent one"]
      }
    }
  ],
  "test_case_comments": [
    {
      "test_case_code": "TC_XXX",
      "issue_type": "missing_step" | "ambiguous_expected" | "duplicate" | "priority_mismatch",
      "severity": "Critical" | "Major" | "Minor",
      "comment": "Detailed explanation of what's wrong and how to fix it"
    }
  ],
  "summary": "2-3 sentences summarizing the biggest risks and top 3 actions to improve"
}

══════════════════════════════════════════════════════════════════
INPUT DATA
══════════════════════════════════════════════════════════════════

[REQUIREMENT]
${input.requirement_description}

[SOURCE DOCUMENTS — AI Document Reader]
${formatDocumentContextForPrompt(input.documents)}

[DOCUMENT COVERAGE — computed by the application, authoritative]
${formatCoverageForPrompt(input.document_coverage)}

[TEST CASES TO AUDIT]
${formatTestCasesForPrompt(input.generated_test_cases)}

══════════════════════════════════════════════════════════════════
OUTPUT: Pure JSON Object strictly following the schema above.`;
}
