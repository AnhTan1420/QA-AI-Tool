import type { GeneratedTestCase, TestCaseCategory } from '@/lib/validators/test-case';

export type GenerationPromptInput = {
  requirement_description: string;
  retrieved_old_test_cases: GeneratedTestCase[];
  selected_categories: TestCaseCategory[];
  language: string;
  detail_level: string;
};

export function buildGenerationPrompt(input: GenerationPromptInput) {
  return `Bạn là một Senior QA Engineer với hơn 10 năm kinh nghiệm viết test case cho sản phẩm phần mềm.
Đọc kỹ mô tả tính năng dưới đây và sinh bộ test case chi tiết, bám sát mô tả.

QUY TẮC:
1. Mỗi test case có đủ: mã, tiêu đề, loại, độ ưu tiên, precondition, dữ liệu test cụ thể (không dùng placeholder mơ hồ), các bước đánh số, expected result ĐO LƯỜNG ĐƯỢC.
2. Bắt buộc sinh đủ các nhóm case theo cấu hình bên dưới.
3. Nếu có test case cũ tham khảo, HỌC THEO văn phong, cấu trúc bước, mức độ chi tiết của đội QA này.
4. Không bịa thông tin ngoài description — nếu thiếu dữ liệu để viết case cụ thể, ghi rõ giả định trong preconditions hoặc test_data.
5. Output CHỈ trả JSON array đúng schema GeneratedTestCase[], không thêm text ngoài JSON.

[DESCRIPTION]
${input.requirement_description}

[TEST CASE CŨ THAM KHẢO — top ${input.retrieved_old_test_cases.length} case liên quan nhất]
${JSON.stringify(input.retrieved_old_test_cases, null, 2)}

[CẤU HÌNH]
- Loại case cần sinh: ${input.selected_categories.join(', ')}
- Ngôn ngữ: ${input.language}
- Mức độ chi tiết: ${input.detail_level}`;
}
