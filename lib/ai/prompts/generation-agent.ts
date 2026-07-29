import type { GeneratedTestCase, TestCaseCategory } from '@/lib/validators/test-case';

export type GenerationPromptInput = {
  requirement_description: string;
  retrieved_old_test_cases: GeneratedTestCase[];
  selected_categories: TestCaseCategory[];
  language: string;
  detail_level: string;
};

// Schema JSON tường minh — PHẢI khớp 100% với generatedTestCaseSchema trong
// lib/validators/test-case.ts. Giữ nguyên cấu trúc vững chắc này để bảo vệ hệ thống.
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
  const categoryConstraint = input.selected_categories.length > 0 
    ? input.selected_categories.join(' | ') 
    : 'Bất kỳ category hợp lệ nào trong schema';

  return `Bạn là một Principal QA Architect kiêm Lead Product Analyst với hơn 20 năm kinh nghiệm xây dựng các hệ thống Enterprise.
Nhiệm vụ của bạn là đọc hiểu mô tả tính năng dưới đây và tự động sinh ra một bộ Test Cases xuất chúng, bao phủ từ giao diện người dùng đến tầng kiến trúc sâu nhất (Backend, DB, Network).

QUY TẮC CỐT LÕI (CORE RULES):
1. LUẬT 300% (Xử lý Input sơ sài): KHÔNG ĐƯỢC PHÉP trả về kết quả hời hợt nếu user nhập mô tả quá ngắn. Hãy tự động giả định bối cảnh ứng dụng, suy luận các "Yêu cầu ngầm định" (Implicit Requirements) và đắp thêm logic nghiệp vụ sát thực tế nhất.
2. MA TRẬN TƯ DUY 5 CHIỀU (Bắt buộc ngầm áp dụng để quét tính năng):
   - Business Logic: Happy path, luồng lỗi, giá trị biên.
   - State & Concurrency (Tương tranh): Race conditions, tính lũy đẳng (Idempotency - submit form 2 lần liên tục/mở 2 tab).
   - Resilience & Chaos (Sức chịu đựng): Rớt mạng giữa chừng, API bên thứ 3 timeout/báo lỗi 500, quá trình rollback Database.
   - Security Sâu: Broken Access Control (Thao túng/đổi IDOR), XSS, Injection cơ bản.
   - UX & Edge Cases: Hết hạn session (JWT expired), luồng UI đa bước.
3. TIÊU CHUẨN KỸ THUẬT SÂU: 
   - Pre-conditions: Ghi rõ trạng thái kỹ thuật (VD: "Session JWT còn hạn", "DB có record X với status = PENDING") chứ không chỉ tả UI bề mặt.
   - Steps: Cụ thể, bao gồm cả thao tác phá hủy hệ thống nếu đang test security/performance/negative.
   - Expected Result: Bắt buộc mô tả cả 2 khía cạnh: UI (người dùng thấy gì) và System/DB (dữ liệu bị rollback hay lưu thế nào). Đo lường được.
4. KẾ THỪA VĂN PHONG QA: Nếu có test case cũ tham khảo, phải phân tích và HỌC THEO văn phong, cách đặt mã code, cấu trúc bước của đội ngũ để giữ tính đồng nhất cho toàn dự án.
5. ĐỊNH DẠNG ĐẦU RA BẤT KHẢ XÂM PHẠM: Output CHỈ trả về một JSON ARRAY thuần (không bọc trong object, không có key bao ngoài, không dùng markdown \`\`\`json). 
Mỗi phần tử BẮT BUỘC đúng CHÍNH XÁC cấu trúc field, kiểu dữ liệu và enum sau (tuyệt đối không tự dịch enum sang tiếng Việt):
${JSON_SCHEMA_CONTRACT}
6. Không thêm bất kỳ text, giải thích hay lời chào nào ngoài JSON array. "category" BẮT BUỘC lấy từ danh sách cấu hình bên dưới.

[DESCRIPTION - MÔ TẢ TÍNH NĂNG]
${input.requirement_description}

[TEST CASE CŨ THAM KHẢO - Top ${input.retrieved_old_test_cases.length} case liên quan nhất để học văn phong]
${JSON.stringify(input.retrieved_old_test_cases, null, 2)}

[CẤU HÌNH BẮT BUỘC]
- Loại case cần sinh (CHỈ dùng ĐÚNG một trong các giá trị này cho field "category"): ${categoryConstraint}
- Ngôn ngữ nội dung (dành cho title/action/expected_result...): ${input.language}
- Mức độ chi tiết (Detail Level - Áp dụng triệt để Ma trận 5 chiều nếu mức độ là Cao/Chuyên sâu): ${input.detail_level}
`;
}
