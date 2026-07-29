import type { GeneratedTestCase } from '@/lib/validators/test-case';

export function buildReviewPrompt(input: {
  requirement_description: string;
  generated_test_cases: GeneratedTestCase[];
}) {
  return `Bạn đóng vai Senior QA Lead. REVIEW bộ test case so với requirement.

QUY TẮC OUTPUT:
- Chỉ trả JSON, không thêm text ngoài.
- coverage_score: number 0-100.
- requirement_gaps: array, mỗi item có requirement_text (string) và suggested_test_case (object đúng schema GeneratedTestCase HOẶC null).
- test_case_comments: array, mỗi item có test_case_code (string), issue_type (chỉ 1 trong 4: "missing_step", "ambiguous_expected", "duplicate", "priority_mismatch"), comment (string).

VÍ DỤ OUTPUT ĐÚNG:
{
  "coverage_score": 75,
  "requirement_gaps": [
    {
      "requirement_text": "Chưa test trường hợp email chưa verify",
      "suggested_test_case": null
    }
  ],
  "test_case_comments": [
    {
      "test_case_code": "TC_LOGIN_001",
      "issue_type": "missing_step",
      "comment": "Thiếu bước verify captcha"
    }
  ]
}

[REQUIREMENT]
${input.requirement_description}

[TEST CASES]
${JSON.stringify(input.generated_test_cases, null, 2)}`;
}