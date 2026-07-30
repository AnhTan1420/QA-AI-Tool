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
  "priority": "MOT trong: Critical | Major | Normal",
  "preconditions": ["string", "..."],
  "test_data": { "ten_truong": "gia_tri (LUON la string)" },
  "steps": [
    { "step_number": 1, "action": "string", "expected_result": "string" }
  ],
  "final_expected_result": "string",
  "source_requirement_ids": ["string"]
}`;

export function buildGenerationPrompt(input: GenerationPromptInput) {
  const categoryConstraint = input.selected_categories.length > 0
    ? input.selected_categories.join(', ')
    : 'Bất kỳ category hợp lệ nào trong schema';

  const minCases = input.selected_categories.length > 0 ? input.selected_categories.length : 3;

  // Format test case cũ thành dạng dễ đọc cho AI
  const oldCasesFormatted = input.retrieved_old_test_cases.length > 0
    ? input.retrieved_old_test_cases.map((tc, idx) => `
=== TEST CASE THAM KHẢO #${idx + 1} ===
Code: ${tc.code}
Title: ${tc.title}
Category: ${tc.category}
Priority: ${tc.priority}
Preconditions: ${(tc.preconditions || []).join('; ')}
Test Data: ${JSON.stringify(tc.test_data || {})}
Steps:
${(tc.steps || []).map(s => `  ${s.step_number}. ${s.action}\n     Expected: ${s.expected_result}`).join('\n')}
Final Expected Result: ${tc.final_expected_result}
=== END #${idx + 1} ===
`).join('\n')
    : '(Không có test case cũ nào được import)';

  return `Bạn là một Principal QA Architect kiêm Lead Product Analyst với hơn 20 năm kinh nghiệm xây dựng các hệ thống Enterprise.
Nhiệm vụ của bạn là đọc hiểu mô tả tính năng dưới đây và tự động sinh ra một bộ Test Cases xuất chúng.

QUY TẮC CỐT LÕI (CORE RULES):

1. CHỈ TIÊU BẮT BUỘC (MANDATORY QUOTA):
   - Hệ thống yêu cầu sinh test case cho các danh mục (categories) sau: [${categoryConstraint}].
   - BẠN BẮT BUỘC PHẢI SINH RA ÍT NHẤT 1 TEST CASE CHO MỖI DANH MỤC TRONG DANH SÁCH TRÊN.
   - Tổng số test case trả về PHẢI LỚN HƠN HOẶC BẰNG ${minCases}.

2. HỌC TỪ TEST CASE CŨ (RAG - RETRIEVED OLD TEST CASES):
   - Dưới đây là ${input.retrieved_old_test_cases.length} test case đã được import từ file Excel tham khảo.
   - BẠN PHẢI học style viết, độ chi tiết, format steps, cách đặt tên code, và cấu trúc expected result từ các test case này.
   - Đảm bảo test case mới có cùng "chất lượng" và "style" với test case cũ.
   - Nếu test case cũ đã cover một scenario, KHÔNG sinh trùng lặp. Thay vào đó, sinh case mới bổ sung góc nhìn khác.
   - Nếu không có test case cũ, tự suy luận theo chuẩn industry best practice.

3. LUẬT 300% (Xử lý Input sơ sài): KHÔNG ĐƯỢC PHÉP trả về kết quả hời hợt nếu user nhập mô tả quá ngắn. Hãy tự động giả định bối cảnh ứng dụng, suy luận các "Yêu cầu ngầm định" (Implicit Requirements).

4. TIÊU CHUẨN KỸ THUẬT SÂU:
   - Pre-conditions: Ghi rõ trạng thái kỹ thuật (VD: "Session JWT còn hạn", "DB có record X") chứ không chỉ tả UI bề mặt.
   - Steps: Cụ thể, bao gồm cả thao tác phá hủy hệ thống nếu đang test security/performance.
   - Expected Result: Bắt buộc mô tả cả 2 khía cạnh: UI (người dùng thấy gì) và System/DB (dữ liệu lưu thế nào).
   - Compatibility/Localization/Security: Nếu phải viết test case cho các category này, hãy giả định bối cảnh cực đoan.

5. ĐỊNH DẠNG ĐẦU RA BẤT KHẢ XÂM PHẠM:
   - Output CHỈ trả về một JSON ARRAY thuần (không bọc trong object, không có key bao ngoài, không dùng markdown \`\`\`json).
   - Mỗi phần tử BẮT BUỘC đúng CHÍNH XÁC cấu trúc field sau:
${JSON_SCHEMA_CONTRACT}

[DESCRIPTION - MÔ TẢ TÍNH NĂNG]
${input.requirement_description}

[TEST CASE CŨ ĐÃ IMPORT TỪ EXCEL - HỌC STYLE TỪ ĐÂY]
${oldCasesFormatted}

[CẤU HÌNH BẮT BUỘC]
- Danh sách Category BẮT BUỘC PHẢI PHỦ ĐẦY ĐỦ: ${categoryConstraint}
- Ngôn ngữ nội dung: ${input.language}
- Mức độ chi tiết: ${input.detail_level}
`;
}