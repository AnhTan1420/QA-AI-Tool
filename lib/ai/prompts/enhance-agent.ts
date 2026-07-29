import type { GeneratedTestCase, ReviewResult } from '@/lib/validators/test-case';

export function buildEnhancePrompt(input: {
  requirement_description: string;
  test_cases: GeneratedTestCase[];
  review_result: ReviewResult;
}) {
  return `Bạn đóng vai Senior QA Lead. Dựa trên feedback review, hãy SỬA LẠI và CẢI THIỆN toàn bộ bộ test case.

QUY TẮC TUYỆT ĐỐI:
1. Output CHỈ là JSON array trực tiếp, KHÔNG wrap trong object, KHÔNG thêm key "test_cases".
2. Mỗi phần tử trong array là object đúng schema dưới đây.
3. Giữ nguyên code (TC_XXX) của case đã sửa, chỉ sửa nội dung.
4. Tạo test case MỚI cho mỗi requirement gap.
5. Loại bỏ case trùng lặp/thừa.
6. Coverage phải đạt tối thiểu 90%.

SCHEMA MỖI TEST CASE (phải đúng 100%):
{
  "code": "TC_XXX",
  "title": "string",
  "category": "positive" | "negative" | "boundary" | "ui_ux" | "compatibility" | "performance" | "security" | "integration" | "regression" | "accessibility" | "localization",
  "priority": "P1" | "P2" | "P3" | "P4",
  "preconditions": ["string"],
  "test_data": {"key": "value"},
  "steps": [
    {"step_number": 1, "action": "string", "expected_result": "string"}
  ],
  "final_expected_result": "string"
}

LƯU Ý: field cuối cùng phải là "final_expected_result", KHÔNG PHẢI "expected_result".

[REQUIREMENT]
${input.requirement_description}

[TEST CASES HIỆN TẠI]
${JSON.stringify(input.test_cases, null, 2)}

[REVIEW FEEDBACK]
Coverage: ${input.review_result.coverage_score}%
Gaps: ${JSON.stringify(input.review_result.requirement_gaps, null, 2)}
Comments: ${JSON.stringify(input.review_result.test_case_comments, null, 2)}`;
}