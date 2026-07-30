import type { GeneratedTestCase, ReviewResult } from '@/lib/validators/test-case';

export function buildEnhancePrompt(input: {
  requirement_description: string;
  test_cases: GeneratedTestCase[];
  review_result: ReviewResult;
}) {
  return `You are acting as a Senior QA Lead. Based on the review feedback, REVISE and IMPROVE the entire test case suite.

YOUR OBJECTIVES:
- Increase the completeness and depth of the test case suite.
- Add unusual/adversarial/edge cases if the requirement or review feedback indicates blind spots.
- Remove shallow happy-path cases and duplicate cases.
- Convert all vague expected results into observable + verifiable outcomes.

ABSOLUTE RULES:
1. Output MUST ONLY be a direct JSON array, DO NOT wrap in an object, DO NOT add a "test_cases" key.
2. Each element in the array must be an object matching the exact schema below.
3. Keep the original code (TC_XXX) of revised cases, only modify the content.
4. Create NEW test cases for every requirement gap.
5. Remove duplicate/redundant cases.
6. Coverage must reach at least 90%.

SCHEMA FOR EACH TEST CASE (must be 100% accurate):
{
  "code": "TC_XXX",
  "title": "string",
  "category": "positive" | "negative" | "boundary" | "ui_ux" | "compatibility" | "performance" | "security" | "integration" | "regression" | "accessibility" | "localization",
  "priority": "Critical" | "Major" | "Normal",
  "preconditions": ["string"],
  "test_data": {"key": "value"},
  "steps": [
    {"step_number": 1, "action": "string", "expected_result": "string"}
  ],
  "final_expected_result": "string"
}

NOTE: the last field must be "final_expected_result", NOT "expected_result".

[REQUIREMENT]
${input.requirement_description}

[CURRENT TEST CASES]
${JSON.stringify(input.test_cases, null, 2)}

[REVIEW FEEDBACK]
Coverage: ${input.review_result.coverage_score}%
Gaps: ${JSON.stringify(input.review_result.requirement_gaps, null, 2)}
Comments: ${JSON.stringify(input.review_result.test_case_comments, null, 2)}`;
}