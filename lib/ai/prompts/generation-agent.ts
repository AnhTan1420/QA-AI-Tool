import type { GeneratedTestCase, TestCaseCategory } from '@/lib/validators/test-case';

export type GenerationPromptInput = {
  requirement_description: string;
  retrieved_old_test_cases: GeneratedTestCase[];
  selected_categories: TestCaseCategory[];
  language: string;
  detail_level: string;
};

// Schema JSON tuong minh — PHAI khop 100% voi generatedTestCaseSchema trong
// lib/validators/test-case.ts (ten field, kieu du lieu, enum). AI thuong tu
// bia ten field/gia tri enum neu khong duoc dua schema ro rang vao prompt,
// day la nguyen nhan chinh gay loi "AI tra ve du lieu khong dung dinh dang
// test case" ngay ca khi goi AI thanh cong.
const JSON_SCHEMA_CONTRACT = `{
  "code": "string, VD: TC_LOGIN_001",
  "title": "string",
  "category": "MOT trong cac gia tri: positive | negative | boundary | ui_ux | compatibility | performance | security | integration | regression | accessibility | localization",
  "priority": "MOT trong: P1 | P2 | P3 | P4 (P1 = cao nhat, P4 = thap nhat)",
  "preconditions": ["string", "..."],
  "test_data": { "ten_truong": "gia_tri (LUON la string, khong dung number/boolean/object)" },
  "steps": [
    { "step_number": 1, "action": "string", "expected_result": "string" }
  ],
  "final_expected_result": "string",
  "source_requirement_ids": ["string"]
}`;

export function buildGenerationPrompt(input: GenerationPromptInput) {
  return `Bạn là một Senior QA Engineer với hơn 10 năm kinh nghiệm viết test case cho sản phẩm phần mềm.
Đọc kỹ mô tả tính năng dưới đây và sinh bộ test case chi tiết, bám sát mô tả.

QUY TẮC:
1. Mỗi test case có đủ: mã, tiêu đề, loại, độ ưu tiên, precondition, dữ liệu test cụ thể (không dùng placeholder mơ hồ), các bước đánh số, expected result ĐO LƯỜNG ĐƯỢC.
2. Bắt buộc sinh đủ các nhóm case theo cấu hình bên dưới.
3. Nếu có test case cũ tham khảo, HỌC THEO văn phong, cấu trúc bước, mức độ chi tiết của đội QA này.
4. Không bịa thông tin ngoài description — nếu thiếu dữ liệu để viết case cụ thể, ghi rõ giả định trong preconditions hoặc test_data.
5. Output CHỈ trả một JSON ARRAY thuần (không bọc trong object, không có key bao ngoài), mỗi phần tử BẮT BUỘC đúng CHÍNH XÁC cấu trúc field/kiểu dữ liệu/enum sau (không tự đổi tên field, không tự dịch giá trị enum sang tiếng Việt hay chữ hoa):
${JSON_SCHEMA_CONTRACT}
6. "category" và "priority" phải lấy nguyên văn giá trị enum bên trên (chữ thường, đúng chính tả), KHÔNG dùng nhãn hiển thị như "Functional - Positive" hay "Cao".
7. Không thêm bất kỳ text, markdown, hay giải thích nào ngoài JSON array.

[DESCRIPTION]
${input.requirement_description}

[TEST CASE CŨ THAM KHẢO — top ${input.retrieved_old_test_cases.length} case liên quan nhất]
${JSON.stringify(input.retrieved_old_test_cases, null, 2)}

[CẤU HÌNH]
- Loại case cần sinh (CHỈ dùng đúng các giá trị enum này cho field "category"): ${input.selected_categories.join(', ')}
- Ngôn ngữ nội dung (title/action/expected_result...): ${input.language}
- Mức độ chi tiết: ${input.detail_level}`;
}
