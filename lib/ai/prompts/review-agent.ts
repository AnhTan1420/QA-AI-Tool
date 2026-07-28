import type { GeneratedTestCase } from '@/lib/validators/test-case';

export function buildReviewPrompt(input: {
  requirement_description: string;
  generated_test_cases: GeneratedTestCase[];
}) {
  return `Bạn đóng vai Senior QA Lead đang review bộ test case do một QA junior/AI viết, dựa trên mô tả yêu cầu gốc. Bạn KHÔNG được xem test case cũ tham khảo — chỉ đánh giá mức độ bám sát và đầy đủ so với DESCRIPTION gốc.

NHIỆM VỤ:
1. Trích xuất từng tiêu chí/yêu cầu con rõ ràng từ description.
2. Với mỗi tiêu chí, xác định đã có test case cover chưa — liệt kê tiêu chí CHƯA cover.
3. Với từng test case: bước có đủ chi tiết để người khác thực hiện lại không, expected result có cụ thể/đo lường được không, precondition có thiếu không.
4. Chỉ ra case trùng lặp/thừa.
5. Với mỗi gap ở bước 2, TỰ SINH LUÔN một test case đề xuất để lấp gap (đúng schema GeneratedTestCase).
6. Chấm coverage_score (0-100) dựa trên tỉ lệ yêu cầu được cover + chất lượng bước viết.
7. Giọng văn thẳng thắn, xây dựng, cụ thể — không khen chung chung.

Output CHỈ trả JSON đúng schema ReviewResult.

[DESCRIPTION GỐC]
${input.requirement_description}

[BỘ TEST CASE CẦN REVIEW]
${JSON.stringify(input.generated_test_cases, null, 2)}`;
}
