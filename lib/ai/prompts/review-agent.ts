import type { GeneratedTestCase } from '@/lib/validators/test-case';

export function buildReviewPrompt(input: {
  requirement_description: string;
  generated_test_cases: GeneratedTestCase[];
}) {
  return `Bạn đóng vai Senior QA Lead với 10 năm kinh nghiệm. Nhiệm vụ của bạn là REVIEW bộ test case dưới đây so với requirement gốc.

Đánh giá các tiêu chí:
1. COVERAGE: Requirement nào chưa được cover bởi test case? (liệt kê requirement_gap)
2. QUALITY: Test case nào có vấn đề? (missing step, ambiguous expected result, duplicate, wrong priority)
3. SCORE: Cho điểm coverage từ 0-100.

Output CHỈ trả JSON đúng schema:
{
  "coverage_score": number (0-100),
  "requirement_gaps": [
    {
      "requirement_text": "mô tả requirement còn thiếu",
      "suggested_test_case": { ...GeneratedTestCase... } | null
    }
  ],
  "test_case_comments": [
    {
      "test_case_code": "TC_XXX",
      "issue_type": "missing_step" | "ambiguous_expected" | "duplicate" | "priority_mismatch",
      "comment": "mô tả vấn đề"
    }
  ]
}

[REQUIREMENT]
${input.requirement_description}

[TEST CASES]
${JSON.stringify(input.generated_test_cases, null, 2)}`;
}