import type { GeneratedTestCase, ReviewResult } from '@/lib/validators/test-case';

export function buildEnhancePrompt(input: {
  requirement_description: string;
  test_cases: GeneratedTestCase[];
  review_result: ReviewResult;
}) {
  return `Bạn đóng vai Senior QA Lead. Bạn đã review bộ test case và có feedback chi tiết. Nhiệm vụ của bạn là SỬA LẠI và CẢI THIỆN toàn bộ bộ test case dựa trên feedback review.

QUY TẮC:
1. Sửa từng test case theo review comments (thêm bước còn thiếu, làm rõ expected result, điều chỉnh priority, sửa preconditions).
2. Tạo test case MỚI cho mỗi requirement gap (đúng schema GeneratedTestCase).
3. Merge hoặc loại bỏ case trùng lặp/thừa.
4. Đảm bảo coverage đạt tối thiểu 90%.
5. Giữ nguyên code (TC_XXX) của các case đã sửa, chỉ sửa nội dung.
6. Tất cả test case phải đúng schema: code, title, category, priority, preconditions[], test_data{}, steps[{step_number, action, expected_result}], final_expected_result.

Output CHỈ trả JSON array của test cases đã enhance.

[REQUIREMENT GỐC]
${input.requirement_description}

[BỘ TEST CASE HIỆN TẠI]
${JSON.stringify(input.test_cases, null, 2)}

[REVIEW FEEDBACK]
Coverage score: ${input.review_result.coverage_score}%
Requirement gaps: ${JSON.stringify(input.review_result.requirement_gaps, null, 2)}
Test case comments: ${JSON.stringify(input.review_result.test_case_comments, null, 2)}`;
}