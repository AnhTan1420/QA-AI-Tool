import type { GeneratedTestCase, ReviewResult } from '@/lib/validators/test-case';

export function buildEnhancePrompt(input: {
  requirement_description: string;
  test_cases: GeneratedTestCase[];
  review_result: ReviewResult;
}) {
  return `Bạn đóng vai Senior QA Lead. Dựa trên feedback review, hãy SỬA LẠI và CẢI THIỆN toàn bộ bộ test case.

QUY TẮC:
1. Sửa từng test case theo review comments.
2. Tạo test case MỚI cho mỗi requirement gap.
3. Loại bỏ case trùng lặp/thừa.
4. Coverage phải đạt tối thiểu 90%.
5. Giữ nguyên code (TC_XXX) của case đã sửa.
6. Output CHỈ là JSON array test cases.

[REQUIREMENT]
${input.requirement_description}

[TEST CASES HIỆN TẠI]
${JSON.stringify(input.test_cases, null, 2)}

[REVIEW FEEDBACK]
Coverage: ${input.review_result.coverage_score}%
Gaps: ${JSON.stringify(input.review_result.requirement_gaps, null, 2)}
Comments: ${JSON.stringify(input.review_result.test_case_comments, null, 2)}`;
}