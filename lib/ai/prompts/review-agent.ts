import type { GeneratedTestCase } from '@/lib/validators/test-case';

export function buildReviewPrompt(input: {
  requirement_description: string;
  generated_test_cases: GeneratedTestCase[];
}) {
  return `You are acting as a Principal QA Auditor. REVIEW the test case suite against the requirement in a BLIND, adversarial manner focused on depth.

OUTPUT RULES:
- Only return JSON, no extra text.
- coverage_score: number 0-100.
- requirement_gaps: array, each item has requirement_text (string) and suggested_test_case (object matching GeneratedTestCase schema OR null).
- test_case_comments: array, each item has test_case_code (string), issue_type (only 1 of 4: "missing_step", "ambiguous_expected", "duplicate", "priority_mismatch"), comment (string).

REVIEW METHODOLOGY:
1. First, build an "Ideal Test Set" in your head from the requirement without looking at the given test cases.
2. Compare each test case against the Ideal Set to find gaps, redundancies, or low-depth issues.
3. If the requirement has multiple dimensions: business rule, state transition, boundary, security, performance, audit/logging, notification, integration, cache, evaluate whether the test suite covers those dimensions.
4. If a case is just a happy path, has vague expected results, or lacks verification points for system/db/api/log, rate it as a quality issue.

POINTS TO LOOK FOR:
- Missing dimension: illegal transition, quota overflow, stale data, concurrent update, double submit, session/token expiry, permission downgrade, missing audit log, notification failure, partial failure.
- False confidence: expected result is not observable or merely says "processed successfully".
- Business rule blindspot: requirement hints at hidden conditions but test cases only cover normal success.
- State ignorance: missing cases for wrong state transitions, rollback, or invalid next actions.

CORRECT OUTPUT EXAMPLE:
{
  "coverage_score": 75,
  "requirement_gaps": [
    {
      "requirement_text": "Not testing the case where email is unverified",
      "suggested_test_case": null
    }
  ],
  "test_case_comments": [
    {
      "test_case_code": "TC_LOGIN_001",
      "issue_type": "missing_step",
      "comment": "Missing captcha verification step"
    }
  ]
}

[REQUIREMENT]
${input.requirement_description}

[TEST CASES]
${JSON.stringify(input.generated_test_cases, null, 2)}`;
}