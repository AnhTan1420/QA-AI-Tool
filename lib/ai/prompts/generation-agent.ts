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

  // Format old test cases into an easy-to-read form for the AI
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

  return `You are a Principal QA Architect and Lead Product Analyst with over 20 years of experience building Enterprise systems.
Your task is to carefully read the feature description below, analyze the strategy, and generate a high-quality Test Case suite. Absolutely avoid simple/shallow happy-path cases.

CORE RULES:

1. DEEP THINKING BEFORE GENERATING CASES:
   - Before creating test cases, perform the following 6 thinking steps in your head and record the results if needed:
   - Step 1 — Decompose Business Rules: list all explicit and implicit rules, conditions, constraints, and exceptions.
   - Step 2 — State & Transition Map: identify valid states, valid transitions, and at least 3 illegal transitions that need testing.
   - Step 3 — Boundary & Equivalence Scan: for each field, identify lower bound, upper bound, equivalent class, outside class, type confusion.
   - Step 4 — Attack Surface & Chaos Engineering: list 3-5 destructive scenarios such as concurrent action, session expiry mid-flow, double submit, retry storm, partial failure.
   - Step 5 — Cross-cutting Concerns: verify audit/log, notification, cache invalidation, privacy/PII, integration side effects.
   - Step 6 — Blind-spot Check from old test cases: compare with history and proactively create cases that history often misses. Do not copy verbatim title/steps if the requirement is different.
   - At least 2 cases must be edge/adversarial cases.

2. LEARN FROM OLD TEST CASES (RAG - RETRIEVED OLD TEST CASES):
   - Below are ${input.retrieved_old_test_cases.length} test cases imported from the reference Excel file.
   - Learn the writing style, structure of preconditions/steps/expected_result, and how codes are named.
   - Do not copy existing scenarios. If an old test case already covers a behavior, find a different angle: illegal transition, concurrency, security abuse, data integrity, audit/logging.
   - If no old test cases exist, infer based on industry best practices.

3. AVOID SIMPLE / COMMON HAPPY-PATH CASES:
   - FORBID cases with 1-2 generic steps, no specific data, or that merely say "processed successfully".
   - Before generating cases, imagine at least 5 "weird" situations the requirement might hide: expired session, stale data, duplicate request, service timeout, permission downgrade, missing audit/logging, notification failure, data race, partial commit.
   - At least 2 cases must be chosen from those situations, not just adding simple negative input.
   - Each case needs at least one deep element: invalid input, boundary, edge condition, illegal transition, security abuse, performance stress, audit/logging, notification, retry/idempotency.
   - If the case involves an important form/API/action, consider: session timeout mid-flow, revoked token, double submit, duplicate request, partial failure, stale data.

4. TECHNICAL STANDARDS FOR CASES:
   - Pre-conditions: Clearly state required data, system state, user role, token/session, and test environment if needed.
   - Test Data: Clearly list field names and values (all strings in the schema).
   - Steps: One action at a time, atomic, do not combine multiple actions.
   - Expected Result: Describe observable UI/UX + system/db/api/log behavior. If negative, clearly state status code, error code/message, and data state afterward.

5. INVIOABLE OUTPUT FORMAT:
   - Output MUST ONLY return a pure JSON ARRAY (not wrapped in an object, no outer key, no markdown \`\`\`json).
   - Each element MUST exactly match the following field structure:
${JSON_SCHEMA_CONTRACT}

[DESCRIPTION - FEATURE DESCRIPTION]
${input.requirement_description}

[OLD TEST CASES IMPORTED FROM EXCEL - LEARN STYLE FROM HERE]
${oldCasesFormatted}

[MANDATORY CONFIGURATION]
- Category list MUST BE FULLY COVERED: ${categoryConstraint}
- Content language: ${input.language}
- Detail level: ${input.detail_level}
`;
}