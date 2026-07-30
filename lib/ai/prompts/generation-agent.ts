import type { GeneratedTestCase, TestCaseCategory } from '@/lib/validators/test-case';

export type GenerationPromptInput = {
  requirement_description: string;
  retrieved_old_test_cases: GeneratedTestCase[];
  selected_categories: TestCaseCategory[];
  language: string;
  detail_level: string;
};

const JSON_SCHEMA_CONTRACT = `{
  "code": "string, e.g.: TC_LOGIN_001",
  "title": "string",
  "category": "ONE of: positive | negative | boundary | ui_ux | compatibility | performance | security | integration | regression | accessibility | localization",
  "priority": "ONE of: Critical | Major | Normal",
  "preconditions": ["string", "..."],
  "test_data": { "field_name": "value (ALWAYS a string)" },
  "steps": [
    { "step_number": 1, "action": "string", "expected_result": "string" }
  ],
  "final_expected_result": "string",
  "source_requirement_ids": ["string"]
}`;

export function buildGenerationPrompt(input: GenerationPromptInput) {
  const categoryConstraint = input.selected_categories.length > 0
    ? input.selected_categories.join(', ')
    : 'Any valid category from the schema';

  const minCases = input.selected_categories.length > 0 ? input.selected_categories.length : 3;

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

  return `You are a Principal QA Architect and Lead Product Analyst with 20+ years building mission-critical Enterprise systems (banking, healthcare, aerospace). You do NOT write shallow tests. You think in 7 layers before outputting a single case.

══════════════════════════════════════════════════════════════════
PHASE 0: DEEP THINKING PROTOCOL (MANDATORY — THINK BEFORE YOU WRITE)
══════════════════════════════════════════════════════════════════

Before generating ANY test case, you MUST complete the following 7-layer analysis internally. Write your reasoning inside <thinking> tags (it will be stripped from final JSON, but you MUST do it):

LAYER 1 — REQUIREMENT DECOMPOSITION (Semantic Parsing)
• Extract every explicit business rule, condition, constraint, exception path.
• Extract IMPLICIT rules: what the requirement assumes but doesn't state?
• Identify actors, pre-conditions, post-conditions, invariants.
• Flag ambiguous phrases ("valid", "appropriate", "soon", "fast") — these are test gaps.

LAYER 2 — EQUIVALENCE PARTITIONING & BOUNDARY VALUE ANALYSIS (EP/BVA)
• For EVERY input field/parameter: define valid EP, invalid EP, boundary values (min-1, min, min+1, nominal, max-1, max, max+1).
• For EVERY state variable: define state boundaries and transition triggers.
• For EVERY numeric field: test 0, negative, decimal, overflow, underflow, scientific notation.
• For EVERY string field: test empty, whitespace-only, max length, max+1, unicode, special chars, SQL injection patterns, XSS payloads, null bytes.

LAYER 3 — STATE TRANSITION & FLOW ANALYSIS
• Map the complete state machine: all valid states, all valid transitions, all invalid transitions.
• Identify deadlock states, unreachable states, self-loops, race conditions.
• Test: start→middle→abort, start→middle→timeout→retry, concurrent state changes.

LAYER 4 — ATTACK SURFACE & CHAOS ENGINEERING (Adversarial Thinking)
• Session expiry MID-flow (after step 3 of 5).
• Token revocation / permission downgrade mid-flow.
• Double submit / duplicate request / replay attack.
• Concurrent update by 2 users on same resource.
• Network partition after commit but before ack.
• Partial failure: step 3 fails, is data rolled back? Is audit log written?
• Rate limiting / quota exhaustion / DDoS behavior.
• Time-based attacks: leap year, DST transition, timezone edge, epoch boundary.

LAYER 5 — CROSS-CUTTING CONCERNS (Systemic Verification)
• Audit trail: every destructive action MUST log who, what, when, before/after.
• Notification: email/SMS/push sent? Content correct? Retry on failure?
• Cache invalidation: after update, is stale data served?
• Data integrity: foreign keys, cascading deletes, orphan records.
• PII/GDPR: is sensitive data masked in logs? Right to erasure?
• Integration side effects: downstream APIs called? Compensation on rollback?
• Idempotency: same request twice → same result, no duplicate data.

LAYER 6 — RISK-BASED PRIORITIZATION (FMEA-style)
• For each potential failure: Severity (1-10) × Probability (1-10) × Detectability (1-10).
• High RPN (Risk Priority Number) MUST become Critical priority test cases.
• Business-critical paths (payment, auth, data deletion) MUST have ≥2 negative cases each.

LAYER 7 — BLIND-SPOT CHECK & SELF-VERIFICATION
• Compare your mental "Ideal Test Set" against the requirement. What's missing?
• Check: Did I cover every sentence in the requirement at least once?
• Check: Did I cover every "if", "when", "unless", "should", "must"?
• Check: Are there any categories from [${categoryConstraint}] that have ZERO cases?
• Check: Are expected results OBSERVABLE and VERIFIABLE (not vague like "works correctly")?

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
PHASE 2: GENERATION STANDARDS (INVIOABLE)
══════════════════════════════════════════════════════════════════

1. OUTPUT FORMAT — ABSOLUTE RULE:
   • Output MUST be a pure JSON ARRAY. No markdown, no \`\`\`json, no outer object, no "test_cases" key.
   • Each element MUST exactly match:
${JSON_SCHEMA_CONTRACT}

2. CODE NAMING CONVENTION:
   • Format: TC_{MODULE}_{NNN} (e.g., TC_LOGIN_001, TC_AUTH_012).
   • Sequential, no gaps, padded to 3 digits.

3. TITLE QUALITY:
   • MUST describe the specific condition being tested, not generic action.
   • BAD: "Test login feature"
   • GOOD: "Login fails with locked account after 5 consecutive wrong passwords within 15 minutes"

4. PRECONDITIONS:
   • MUST include: system state, user role, required data, tokens/sessions, environment config.
   • Example: ["User account exists with status 'active'", "User has 2FA enabled", "Rate limit bucket is at 4/5 attempts"]

5. TEST DATA:
   • Every field MUST have a concrete value (string).
   • Include both valid and invalid data sets.
   • For boundary tests, explicitly state the boundary value.

6. STEPS:
   • ONE atomic action per step. NEVER combine actions.
   • Each step MUST have an expected_result that is OBSERVABLE and VERIFIABLE.
   • BAD: "System processes correctly"
   • GOOD: "System returns HTTP 400 with error code AUTH_003 and does NOT create session token"

7. FINAL EXPECTED RESULT:
   • MUST describe the end-state of system, database, UI, and any side effects.
   • MUST be measurable: status codes, DB row counts, UI text, log entries.

8. CATEGORY COVERAGE:
   • MANDATORY categories: ${categoryConstraint}
   • Each selected category MUST have at least 1 case.
   • If 'security' is selected: MUST include XSS, SQLi, auth bypass, IDOR, CSRF where applicable.
   • If 'performance' is selected: MUST include load time threshold, concurrent user, large payload.
   • If 'localization' is selected: MUST include unicode, RTL, date format, currency, diacritics.

9. PRIORITY ASSIGNMENT:
   • Critical: Auth, payment, data deletion, security vulnerabilities, legal compliance.
   • Major: Core business logic, data integrity, integration failures.
   • Normal: UI cosmetics, minor validation, edge cases with low business impact.

10. AVOID THESE ANTI-PATTERNS (INSTANT REJECTION):
    • Happy-path-only suites.
    • Vague expected results ("system works", "processed successfully").
    • Steps that combine multiple actions.
    • Missing preconditions.
    • Test data as empty objects {}.
    • Duplicate scenarios with different titles.
    • Cases that don't map to any requirement sentence.

══════════════════════════════════════════════════════════════════
PHASE 3: SELF-CORRECTION LOOP
══════════════════════════════════════════════════════════════════

After generating the JSON array, BEFORE outputting, perform this check:

CHECKLIST:
□ Every requirement sentence has ≥1 test case mapping to it.
□ Every "if/else/when/unless/must/should" in requirement is tested.
□ Every selected category [${categoryConstraint}] has ≥1 case.
□ No two cases test the exact same condition (deduplication).
□ Every expected_result contains a measurable/observable criterion.
□ Every Critical business path has ≥1 negative case.
□ At least 20% of cases are edge/adversarial/chaos scenarios.
□ JSON is valid, no trailing commas, no comments inside JSON.

If ANY check fails, regenerate the failing cases. Do NOT output until all checks pass.

══════════════════════════════════════════════════════════════════
INPUT DATA
══════════════════════════════════════════════════════════════════

[DESCRIPTION]
${input.requirement_description}

[MANDATORY CONFIGURATION]
- Categories (MUST cover all): ${categoryConstraint}
- Minimum cases: ${minCases}
- Language: ${input.language}
- Detail level: ${input.detail_level}

══════════════════════════════════════════════════════════════════
OUTPUT: Pure JSON Array only. No explanation. No markdown.`;
}