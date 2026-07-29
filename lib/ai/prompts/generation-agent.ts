import type { GeneratedTestCase, TestCaseCategory } from '@/lib/validators/test-case';

export type GenerationPromptInput = {
  requirement_description: string;
  retrieved_old_test_cases: GeneratedTestCase[];
  selected_categories: TestCaseCategory[];
  language: string;
  detail_level: string;
};

const JSON_SCHEMA_CONTRACT = `{
  "code": "string, VD: TC_LOGIN_001",
  "title": "string",
  "category": "MOT trong cac gia tri: positive | negative | boundary | ui_ux | compatibility | performance | security | integration | regression | accessibility | localization",
  "priority": "MOT trong: P1 | P2 | P3 | P4",
  "preconditions": ["string", "..."],
  "test_data": { "ten_truong": "gia_tri (LUON la string)" },
  "steps": [
    { "step_number": 1, "action": "string", "expected_result": "string" }
  ],
  "final_expected_result": "string",
  "source_requirement_ids": ["string"]
}`;

export function buildGenerationPrompt(input: GenerationPromptInput) {
  // Nối danh sách category thành chuỗi rõ ràng
  const categoryConstraint = input.selected_categories.length > 0 
    ? input.selected_categories.join(', ') 
    : 'Bất kỳ category hợp lệ nào trong schema';

  // Tính toán số lượng tối thiểu để ép AI
  const minCases = input.selected_categories.length > 0 ? input.selected_categories.length : 3;

  return `Bạn là một Principal QA Architect kiêm Lead Product Analyst với hơn 20 năm kinh nghiệm xây dựng các hệ thống Enterprise.
Nhiệm vụ của bạn là đọc hiểu mô tả tính năng dưới đây và tự động sinh ra một bộ Test Cases xuất chúng.

QUY TẮC CỐT LÕI (CORE RULES):

1. CHỈ TIÊU BẮT BUỘC (MANDATORY QUOTA) - ĐỌC KỸ:
   - Hệ thống yêu cầu sinh test case cho các danh mục (categories) sau: [${categoryConstraint}].
   - BẠN BẮT BUỘC PHẢI SINH RA ÍT NHẤT 1 TEST CASE CHO MỖI DANH MỤC TRONG DANH SÁCH TRÊN.
   - Tổng số test case trả về PHẢI LỚN HƠN HOẶC BẰNG ${minCases}. Tuyệt đối không được bỏ sót bất kỳ category nào mà user đã chọn!

2. LUẬT 300% (Xử lý Input sơ sài): KHÔNG ĐƯỢC PHÉP trả về kết quả hời hợt nếu user nhập mô tả quá ngắn. Hãy tự động giả định bối cảnh ứng dụng, suy luận các "Yêu cầu ngầm định" (Implicit Requirements).

3. TIÊU CHUẨN KỸ THUẬT SÂU: 
   - Pre-conditions: Ghi rõ trạng thái kỹ thuật (VD: "Session JWT còn hạn", "DB có record X") chứ không chỉ tả UI bề mặt.
   - Steps: Cụ thể, bao gồm cả thao tác phá hủy hệ thống nếu đang test security/performance.
   - Expected Result: Bắt buộc mô tả cả 2 khía cạnh: UI (người dùng thấy gì) và System/DB (dữ liệu lưu thế nào).
   - Compatibility/Localization/Security: Nếu phải viết test case cho các category này (dựa theo danh sách yêu cầu), hãy giả định bối cảnh cực đoan (VD: Dùng Safari phiên bản cũ, đổi múi giờ, thử XSS payload).

4. ĐỊNH DẠNG ĐẦU RA BẤT KHẢ XÂM PHẠM: Output CHỈ trả về một JSON ARRAY thuần (không bọc trong object, không có key bao ngoài, không dùng markdown \`\`\`json). 
Mỗi phần tử BẮT BUỘC đúng CHÍNH XÁC cấu trúc field, kiểu dữ liệu và enum sau (tuyệt đối không tự dịch enum sang tiếng Việt):
${JSON_SCHEMA_CONTRACT}
- Field "category" PHẢI LÀ MỘT TRONG CÁC GIÁ TRỊ TỪ DANH SÁCH CẤU HÌNH.

[DESCRIPTION - MÔ TẢ TÍNH NĂNG]
${input.requirement_description}

[TEST CASE CŨ THAM KHẢO - Top ${input.retrieved_old_test_cases.length} case]
${JSON.stringify(input.retrieved_old_test_cases, null, 2)}

[CẤU HÌNH BẮT BUỘC]
- Danh sách Category BẮT BUỘC PHẢI PHỦ ĐẦY ĐỦ (Ít nhất 1 case cho MỖI category dưới đây): ${categoryConstraint}
- Ngôn ngữ nội dung: ${input.language}
- Mức độ chi tiết: ${input.detail_level}
`;
}
