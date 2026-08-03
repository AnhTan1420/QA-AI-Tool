import type { GeneratedTestCase, TestCaseCategory } from '@/lib/validators/test-case';
import type { ParsedDocument } from '@/lib/validators/document';

export type GenerationPromptInput = {
  requirement_description: string;
  retrieved_old_test_cases: GeneratedTestCase[];
  selected_categories: TestCaseCategory[];
  language: string;
  detail_level: string;
  // AI Document Reader: Figma design / Markdown / logic document / FS / ERD / diagram,
  // da duoc atomize truoc (xem PHASE 0 ben duoi + lib/documents/coverage.ts).
  document_context: ParsedDocument[];
};

export function buildGenerationPrompt(input: GenerationPromptInput) {
  // ── 1. TÍNH TOÁN CÁC BIẾN RÀNG BUỘC ──────────────────────────────────────
  const categoryConstraint = input.selected_categories.length > 0
    ? input.selected_categories.join(', ')
    : 'Any valid category from the schema';

  const perCategoryMinByDetail: Record<string, number> = { concise: 2, standard: 4, detailed: 6 };
  const perCategoryMin = perCategoryMinByDetail[input.detail_level] ?? 4;
  const categoriesForMin = input.selected_categories.length > 0 ? input.selected_categories : ['positive', 'negative', 'boundary'];
  const minCases = perCategoryMin * categoriesForMin.length;
  
  const minStepsByDetail: Record<string, number> = { concise: 3, standard: 5, detailed: 7 };
  const minSteps = minStepsByDetail[input.detail_level] ?? 5;

  // Tối ưu số lượng Token Output cho level 'concise' để tránh lỗi đứt gãy JSON
  const omitComplexAnalysis = input.detail_level === 'concise' 
    ? ' (SKIP this layer for concise detail_level. Return empty array [])' 
    : '';

  // ── 2. ĐỊNH NGHĨA SCHEMAS (Đã fix lỗi ép kiểu và tối ưu logic) ───────────
  const TEST_CASE_SCHEMA_CONTRACT = `{
  "code": "string (e.g., TC_LOGIN_001)",
  "title": "string",
  "category": "string (enum: positive, negative, boundary, ui_ux, compatibility, performance, security, integration, regression, accessibility, localization)",
  "priority": "string (enum: Critical, Major, Normal)",
  "preconditions": ["string"],
  "test_data": { "field_name": "string (ALWAYS explicitly cast to string)" },
  "steps": [
    { "step_number": "number", "action": "string", "expected_result": "string" }
  ],
  "final_expected_result": "string",
  "source_requirement_ids": ["string (MUST contain at least one atom_id if documents are provided)"]
}`;

  const ANALYSIS_SCHEMA_CONTRACT = `{
  "input_source": "string (enum: requirement_description, document_context, both) — which source actually has usable content, decided BEFORE any other field",
  "explicit_rules": ["every business rule / condition / constraint / exception path stated outright in the source"],
  "implicit_rules": ["rules the source ASSUMES but never states outright"],
  "ambiguous_terms": ["vague word or phrase found (e.g. 'valid', 'soon') -> why it's ambiguous -> what test gap it creates"],
  "actors_and_preconditions": ["actor / pre-condition / post-condition / invariant identified"],
  "fields_ep_bva": [
    { "field": "string", "valid_equivalence_classes": ["..."], "invalid_equivalence_classes": ["..."], "boundary_values": ["min-1, min, min+1, nominal, max-1, max, max+1, empty, overflow, unicode..."] }
  ],
  "state_transitions": ["state A -> state B on event/trigger X (flag if invalid transition, deadlock, unreachable state)"${omitComplexAnalysis}],
  "attack_and_chaos_vectors": ["adversarial/chaos scenario worth testing: session expiry mid-flow, token revocation, double submit, concurrent update, rate limit..."${omitComplexAnalysis}],
  "cross_cutting_checks": ["systemic concern to verify: audit trail, notification, cache invalidation, data integrity, PII/GDPR, idempotency..."${omitComplexAnalysis}],
  "risk_ranking": [ { "scenario": "string", "severity_1_10": "number", "probability_1_10": "number", "detectability_1_10": "number", "resulting_priority": "string (enum: Critical, Major, Normal)" } ],
  "document_atom_plan": [ { "atom_id": "string (leave empty array if no documents attached)", "planned_test_case_code": "TC_XXX_NNN — which case in test_cases will cover this atom" } ],
  "coverage_self_check": ["one line PER selected category confirming it will reach the required minimum case count", "one line confirming every requirement sentence / document atom ends up mapped to >=1 planned case"]
}`;

  // ── 3. CHUẨN BỊ DỮ LIỆU ĐẦU VÀO ───────────────────────────────────────────
  const oldCasesFormatted = input.retrieved_old_test_cases.length > 0
    ? input.retrieved_old_test_cases.map((tc, idx) => `
=== REFERENCE TEST CASE #${idx + 1} ===
Code: ${tc.code}
Title: ${tc.title}
Category: ${tc.category}
Priority: ${tc.priority}
Preconditions: ${(tc.preconditions || []).join('; ')}
Test Data: ${JSON.stringify(tc.test_data || {})}
Steps:
${(tc.steps || []).map(s => `  ${s.step_number}. ${s.action}\n     Expected: ${s.expected_result}`).join('\n')}
Final Expected Result: ${tc.final_expected_result}
=== END #${idx + 1} ===
`).join('\n')
    : '(No old test cases were imported)';

  const documentContextFormatted = input.document_context.length > 0
    ? input.document_context.map((doc, idx) => `
=== DOCUMENT #${idx + 1}: ${doc.title} (source: ${doc.source_type}) ===
Summary: ${doc.summary}
Atoms (${doc.atoms.length} — each MUST be mapped in analysis.document_atom_plan AND appear in source_requirement_ids of at least one test case):
${doc.atoms.map(a => `  [${a.atom_id}] (${a.atom_type}${a.screen_or_section ? `, ${a.screen_or_section}` : ''}) ${a.label} — ${a.detail}`).join('\n')}
=== END DOCUMENT #${idx + 1} ===
`).join('\n')
    : '(No documents were attached via the AI Document Reader — proceed using only the requirement description below.)';

  const hasDescription = input.requirement_description.trim().length > 0;
  const hasDocuments = input.document_context.length > 0;
  const primarySourceInstruction = hasDescription && hasDocuments
    ? `Both mục 1 (Requirement/description) and mục 2 (AI Document Reader) are provided below. Analyze BOTH, cross-check them against each other, and record any contradiction you find as an entry in "analysis.ambiguous_terms".`
    : hasDocuments
      ? `ONLY mục 2 (AI Document Reader: Figma/document/FS/ERD/diagram) is provided — mục 1 (requirement_description) is empty or negligible. You MUST derive "explicit_rules"/"implicit_rules"/"actors_and_preconditions"/etc. from the DOCUMENT ATOMS in PHASE 0.5 below, NOT from the near-empty description text.`
      : `ONLY mục 1 (Requirement/description) is provided — no documents were attached via AI Document Reader. Derive the entire analysis from the description text in INPUT DATA below. Leave "analysis.document_atom_plan" as an empty array.`;

  // ── 4. TRẢ VỀ PROMPT HOÀN CHỈNH ──────────────────────────────────────────
  return `You are a Principal QA Architect and Lead Product Analyst with 20+ years building mission-critical Enterprise systems (banking, healthcare, aerospace). You do NOT write shallow tests. You think in 7 layers, and you PROVE it in structured output, before a single test case is written.

══════════════════════════════════════════════════════════════════
PHASE 0: DEEP THINKING PROTOCOL (MANDATORY — ANALYZE SECTION 1 / SECTION 2 BEFORE YOU WRITE)
══════════════════════════════════════════════════════════════════

${primarySourceInstruction}

Before writing "test_cases", you MUST fully populate the "analysis" object (schema in PHASE 2) — it comes FIRST in your JSON output, so it is genuinely produced before any test case, not an afterthought. Use these 7 layers to fill it in:

LAYER 1 — REQUIREMENT DECOMPOSITION (Semantic Parsing) → fills explicit_rules / implicit_rules / ambiguous_terms / actors_and_preconditions
• Extract every explicit business rule, condition, constraint, exception path from the primary source identified above.
• Extract IMPLICIT rules: what the source assumes but doesn't state?
• Identify actors, pre-conditions, post-conditions, invariants.
• Flag ambiguous phrases ("valid", "appropriate", "soon", "fast") — these are test gaps.

LAYER 2 — EQUIVALENCE PARTITIONING & BOUNDARY VALUE ANALYSIS (EP/BVA) → fills fields_ep_bva
• For EVERY input field/parameter: define valid EP, invalid EP, boundary values (min-1, min, min+1, nominal, max-1, max, max+1).
• For EVERY state variable: define state boundaries and transition triggers.
• For EVERY numeric field: test 0, negative, decimal, overflow, underflow, scientific notation.
• For EVERY string field: test empty, whitespace-only, max length, max+1, unicode, special chars, SQL injection patterns, XSS payloads, null bytes.

LAYER 3 — STATE TRANSITION & FLOW ANALYSIS → fills state_transitions
• Map the complete state machine: all valid states, all valid transitions, all invalid transitions.
• Identify deadlock states, unreachable states, self-loops, race conditions.
• Note: start→middle→abort, start→middle→timeout→retry, concurrent state changes.

LAYER 4 — ATTACK SURFACE & CHAOS ENGINEERING (Adversarial Thinking) → fills attack_and_chaos_vectors
• Session expiry MID-flow (after step 3 of 5). Token revocation / permission downgrade mid-flow.
• Double submit / duplicate request / replay attack. Concurrent update by 2 users on same resource.
• Network partition after commit but before ack. Partial failure: step 3 fails — is data rolled back? Is audit log written?
• Rate limiting / quota exhaustion / DDoS behavior. Time-based attacks: leap year, DST transition, timezone edge, epoch boundary.

LAYER 5 — CROSS-CUTTING CONCERNS (Systemic Verification) → fills cross_cutting_checks
• Audit trail: every destructive action MUST log who, what, when, before/after.
• Notification: email/SMS/push sent? Content correct? Retry on failure?
• Cache invalidation: after update, is stale data served? Data integrity: foreign keys, cascading deletes, orphan records.
• PII/GDPR: is sensitive data masked in logs? Right to erasure? Integration side effects: downstream APIs called? Compensation on rollback? Idempotency: same request twice → same result.

LAYER 6 — RISK-BASED PRIORITIZATION (FMEA-style) → fills risk_ranking
• For each potential failure: Severity (1-10) × Probability (1-10) × Detectability (1-10).
• High RPN (Risk Priority Number) MUST become Critical priority test cases.
• Business-critical paths (payment, auth, data deletion) MUST have ≥2 negative cases each.

LAYER 7 — BLIND-SPOT CHECK & SELF-VERIFICATION → fills coverage_self_check (run this AFTER drafting risk_ranking, BEFORE writing test_cases)
• Compare your mental "Ideal Test Set" against the source. What's missing?
• Check: did you cover every sentence in the requirement / every atom in the documents at least once?
• Check: did you cover every "if", "when", "unless", "should", "must"?
• Check: are there any categories from [${categoryConstraint}] that would have ZERO cases?
• Check: will expected results be OBSERVABLE and VERIFIABLE (not vague like "works correctly")?

══════════════════════════════════════════════════════════════════
PHASE 0.5: DOCUMENT CONTEXT (Figma / Markdown / FS / ERD / Diagrams) — mục 2
══════════════════════════════════════════════════════════════════

${documentContextFormatted}

MANDATORY MAPPING RULE — 100% ATOM COVERAGE (skip this block entirely if no documents are listed above):
• Every atom above has a unique atom_id (e.g. "FIG_login_email_input", "FS-3.2.1", "ERD-users.status").
• EVERY SINGLE atom_id MUST get an entry in "analysis.document_atom_plan" AND MUST appear in the source_requirement_ids array of AT LEAST ONE test case you output. Zero orphan atoms — this is not optional.
• One test case MAY reference multiple atoms (e.g. a login case can cite both a Figma field atom and an FS validation-rule atom) — put ALL atom_ids it exercises into that case's source_requirement_ids.
• A purely cosmetic/decorative atom (a static label with no behavior to verify) still needs a lightweight ui_ux case (e.g. "Verify label text matches design") rather than being silently dropped. Omission is only acceptable when an atom is an exact literal duplicate of another atom you already mapped.
• "entity_field" atoms (ERD) with constraints are first-class boundary/negative test sources: a NOT NULL field needs an empty-value negative case, a UNIQUE field needs a duplicate-value negative case, an FK needs an orphan-reference negative case.
• "relationship" atoms (ERD) are integration/regression test sources — verify cascade behavior (does deleting the parent cascade, restrict, or orphan the child?).
• "flow_step"/"state" atoms (diagrams) are state-transition test sources per LAYER 3 above — every decision branch shown in the diagram needs its own case.
• "screen_element" atoms (Figma/UI mockups) are UI/UX + functional test sources — fold the literal visible label/placeholder text into your expected_result assertions so results stay pixel-accurate to the design, not generic.

══════════════════════════════════════════════════════════════════
PHASE 1: LEARN FROM OLD TEST CASES (RAG)
══════════════════════════════════════════════════════════════════

${oldCasesFormatted}

Rules for RAG:
• Learn the WRITING STYLE, STRUCTURE, and GRANULARITY of preconditions/steps/expected_result.
• Learn how test data is structured (field names, value types).
• DO NOT copy scenarios verbatim. If an old case covers behavior X, find a DIFFERENT ANGLE: illegal transition, concurrency, security abuse, data integrity, audit/logging gap.
• If old cases are low quality (vague expected results, shallow steps), RAISE the bar in your new cases.

══════════════════════════════════════════════════════════════════
PHASE 2: GENERATION STANDARDS (INVIOLABLE)
══════════════════════════════════════════════════════════════════

1. OUTPUT FORMAT & TRANSLATION — ABSOLUTE RULE:
   • Output MUST be a pure JSON OBJECT with EXACTLY two top-level keys, in this exact order — "analysis" MUST be written first, "test_cases" second:
{
  "analysis": ${ANALYSIS_SCHEMA_CONTRACT},
  "test_cases": [ ${TEST_CASE_SCHEMA_CONTRACT} ]
}
   • TRANSLATION PRECAUTION: You MUST write the content and values of the test cases in the specified language (${input.language}). HOWEVER, you MUST keep all JSON KEYS in English exactly as defined in the schema above. NEVER translate the JSON keys.
   • No markdown, no \`\`\`json, no extra top-level keys, no prose before or after the object.
   • Every test case in "test_cases" MUST trace back to something recorded in "analysis".

2. CODE NAMING CONVENTION:
   • Format: TC_{MODULE}_{NNN} (e.g., TC_LOGIN_001, TC_AUTH_012).
   • CRITICAL: The codes generated here MUST STRICTLY MATCH the "planned_test_case_code" you already defined in "analysis.document_atom_plan". Sequential, no gaps, padded to 3 digits.

3. TITLE QUALITY:
   • MUST describe the specific condition being tested, not generic action.
   • BAD: "Test login feature"
   • GOOD: "Login fails with locked account after 5 consecutive wrong passwords within 15 minutes"

4. PRECONDITIONS:
   • MUST include: system state, user role, required data, tokens/sessions, environment config.
   • Example: ["User account exists with status 'active'", "User has 2FA enabled", "Rate limit bucket is at 4/5 attempts"]

5. TEST DATA — REALISTIC FORMATS (not generic placeholders):
   • Every field MUST have a concrete value (string). Include both valid and invalid data sets.
   • For boundary tests, explicitly state the boundary value (reuse the exact values you listed in analysis.fields_ep_bva).
   • Use REALISTIC-LOOKING values that match the field's actual real-world format, not lazy placeholders:
     - Email: a plausible address (e.g. "nguyen.van.a@company.com"), not "test@test.com" repeated everywhere.
     - Phone: a correctly-formatted number for the locale implied by the requirement (e.g. Vietnamese mobile "0912345678" / +84 912 345 678).
     - Payment card number: a value that actually passes the Luhn checksum for VALID cases (e.g. "4111111111111111"), and one that deliberately FAILS Luhn for invalid-checksum negative cases — state which it is.
     - Currency amount: correct smallest-unit convention if the requirement specifies one (e.g. VND has no decimal subunit; USD cents).
     - Date/time: an actual calendar-valid value in the format the system uses, including deliberately invalid ones for negative cases (Feb 30, 13th month, DST-transition instant) when relevant.
     - IDs/tokens: a plausible-looking format (UUID v4, order number pattern like "ORD-2026-000123"), not literally the word "string" or "abc123" unless the case is specifically testing malformed-input rejection.
   • BAD: {"email": "test", "amount": "value"} — placeholder text instead of real values.
   • GOOD: {"email": "tran.thi.b@gmail.com", "amount": "150000", "card_number": "4111111111111111 (Luhn-valid)"}

6. STEPS — GRANULARITY BAR (this is the #1 quality gate; a case failing this gets INSTANT REJECTION):
   • MINIMUM ${minSteps} steps per test case at this detail_level (setup/navigation steps count). A case with fewer steps almost always means 2+ actions got silently merged into one — split it.
   • ONE atomic user/system action per step. NEVER combine actions.
   • Every "action" MUST name the CONCRETE UI element/target, not a generic verb:
     - Reference the exact screen/page/section name.
     - Reference the exact field/button/link label as it would appear to a user.
     - Reference the exact value being entered, taken verbatim from this case's own "test_data".
   • BAD (too vague, INSTANT REJECTION): "Nhập dữ liệu hợp lệ", "Submit the form", "Kiểm tra kết quả".
   • GOOD: "2. Nhập '4111111111111111' vào field 'Số thẻ' → Expected: field không hiển thị lỗi."
   • Each step's expected_result MUST be OBSERVABLE and VERIFIABLE at THAT step (status code, error code, exact UI text/toast/label).
   • The LAST step MUST be the one action/assertion that most directly produces the case's "final_expected_result".

7. FINAL EXPECTED RESULT:
   • MUST describe the end-state of system, database, UI, and any side effects.
   • MUST be measurable: status codes, DB row counts, UI text, log entries.

8. CATEGORY COVERAGE:
   • MANDATORY categories: ${categoryConstraint}
   • Each selected category MUST have AT LEAST ${perCategoryMin} distinct, non-overlapping cases. A category with only 1-2 shallow cases is an INSTANT REJECTION.
   • If 'security' is selected: MUST include XSS, SQLi, auth bypass, IDOR, CSRF where applicable.
   • If 'performance' is selected: MUST include load time threshold, concurrent user, large payload.

9. PRIORITY ASSIGNMENT:
   • MUST match the "resulting_priority" you already computed per scenario in analysis.risk_ranking.
   • Critical: Auth, payment, data deletion, security vulnerabilities, legal compliance.
   • Major: Core business logic, data integrity, integration failures.
   • Normal: UI cosmetics, minor validation, edge cases.

10. AVOID THESE ANTI-PATTERNS (INSTANT REJECTION):
    • Happy-path-only suites.
    • Vague expected results ("system works", "processed successfully").
    • Steps that combine multiple actions.
    • Missing preconditions.
    • Duplicate scenarios with different titles.
    • Cases that don't map to any entry in "analysis".

══════════════════════════════════════════════════════════════════
PHASE 3: SELF-CORRECTION LOOP
══════════════════════════════════════════════════════════════════

After drafting both "analysis" and "test_cases", BEFORE outputting, perform this check:

CHECKLIST:
□ analysis.input_source correctly reflects which of mục 1 / mục 2 actually had usable content.
□ Every requirement sentence / document atom has ≥1 test case mapping to it.
□ Every "if/else/when/unless/must/should" captured in analysis is tested.
□ Every selected category [${categoryConstraint}] has ≥${perCategoryMin} distinct cases.
□ Every document atom_id from PHASE 0.5 (if any) appears in source_requirement_ids of ≥1 test case — zero orphan atoms.
□ Every analysis.risk_ranking entry's resulting_priority matches the priority of its test case.
□ No two cases test the exact same condition.
□ Every test case has AT LEAST ${minSteps} steps, and no step's "action" is a vague verb without a concrete UI element/value.
□ Every expected_result contains a measurable/observable criterion.
□ JSON is valid, no trailing commas, no translated keys.

If ANY check fails, revise the failing part of "analysis" or "test_cases" before finalizing. Do NOT output until all checks pass.

══════════════════════════════════════════════════════════════════
INPUT DATA
══════════════════════════════════════════════════════════════════

[mục 1 — DESCRIPTION]
${input.requirement_description || '(empty — see mục 2 / PHASE 0.5 above)'}

[MANDATORY CONFIGURATION]
- Categories (MUST cover all): ${categoryConstraint}
- Minimum cases: ${minCases} total, with AT LEAST ${perCategoryMin} cases per selected category
- Minimum steps per test case: ${minSteps} — each step names a concrete field/button/screen and a real value from test_data
- Language: ${input.language}
- Detail level: ${input.detail_level}

══════════════════════════════════════════════════════════════════
OUTPUT: Pure JSON Object with keys "analysis" then "test_cases", in that order. No explanation. No markdown.`;
}