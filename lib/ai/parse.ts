// ============================================================================
// File: parse.ts
// Chức năng: Tiện ích xử lý dữ liệu trả về từ LLM và phân loại lỗi
// ============================================================================

/**
 * Khi phản hồi AI bị cắt cụt giữa chừng (do vượt maxOutputTokens - hay gặp với tài
 * liệu/set test case có nhiều atom/case), JSON sẽ dở dang ở giữa 1 phần tử mảng,
 * ví dụ: `..."screen_or_section": "3.2"\n    }` rồi hết (thiếu `]` và `}` đóng ngoài).
 * Hàm này duyệt qua chuỗi, theo dõi độ sâu ngoặc { [ (bỏ qua nội dung bên trong
 * chuỗi "..." kể cả ký tự escape \" ), và ghi nhận điểm "an toàn" cuối cùng - tức
 * vị trí ngay sau 1 dấu đóng ngoặc } hoặc ] hoàn chỉnh (nghĩa là phần tử đó đã
 * đóng xong, không dở dang). Nếu JSON.parse thất bại, ta cắt chuỗi tại điểm an
 * toàn cuối cùng đó (bỏ phần tử dở cuối), rồi tự đóng nốt các ngoặc còn mở theo
 * đúng thứ tự ngược lại, và thử parse lại - thay vì mất trắng toàn bộ kết quả chỉ
 * vì 1 phần tử cuối bị cắt cụt.
 */
function repairTruncatedJson(text: string): string | null {
  const openStack: string[] = [];
  let inString = false;
  let escapeNext = false;
  let lastSafeIndex = -1;
  let lastSafeStack: string[] = [];

  // Do sau (do dai openStack NGAY SAU KHI push) cua mang lap-lai o ngoai cung
  // (VD: "test_cases" trong { analysis, test_cases: [...] }, hoac chinh no neu
  // response la bare array [...]). Day la mang "['[' dau tien gap trong text"
  // - vi voi ca 2 dang response ma he thong nay dung (bare array, hoac object
  // bi bao 1 lop voi 1 field la array), mang chua cac phan tu lap lai LUON la
  // mang '[' DAU TIEN xuat hien trong chuoi.
  //
  // SUA LOI QUAN TRONG: truoc day MOI dau dong ngoac (} hoac ]) deu duoc coi la
  // "diem an toan", ke ca cac ngoac dong 1 FIELD LONG BEN TRONG 1 phan tu CHUA
  // hoan chinh (VD: "preconditions": [...] dong xong nhung "steps" va
  // "final_expected_result" phia sau van dang dang do bi cat cut). Dieu nay khien
  // ham "vá" ghep them '}' '] ngay sau field do, tao ra 1 item "gia hoan chinh"
  // nhung thieu cac field con lai (thay vi loai bo han item do nhu y dinh ban
  // dau) -> gay loi "Required" cho tung field cu the (VD: '41.steps',
  // '41.final_expected_result') dung nhu bao cao thuc te. Fix: CHI danh dau la
  // "an toan" khi ngoac dong dua do sau openStack VE DUNG do sau cua mang lap-lai
  // ngoai cung (tuc la vua dong xong TRON VEN 1 phan tu la con truc tiep cua
  // mang do, khong phai 1 field long ben trong phan tu dang do dang).
  let itemArrayDepth: number | null = null;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (ch === '\\') {
        escapeNext = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{' || ch === '[') {
      openStack.push(ch);
      if (ch === '[' && itemArrayDepth === null) {
        itemArrayDepth = openStack.length;
      }
    } else if (ch === '}' || ch === ']') {
      openStack.pop();
      // Chi danh dau "an toan" khi vua dong xong 1 phan tu la CON TRUC TIEP cua
      // mang lap-lai ngoai cung (do sau hien tai == do sau cua mang do) - KHONG
      // phai bat ky ngoac dong nao (xem giai thich o tren).
      if (itemArrayDepth !== null && openStack.length === itemArrayDepth) {
        lastSafeIndex = i;
        lastSafeStack = [...openStack];
      }
    }
  }

  // Khong tim thay diem an toan nao (JSON hong tu dau, hoac chua co phan tu nao
  // trong mang lap-lai dong hoan chinh) hoac khong con ngoac nao dang mo (tuc la
  // JSON da hop le, khong phai loi truncation) -> khong the/khong can vá.
  if (lastSafeIndex === -1 || lastSafeStack.length === 0) return null;

  let repaired = text.slice(0, lastSafeIndex + 1);
  for (let i = lastSafeStack.length - 1; i >= 0; i--) {
    repaired += lastSafeStack[i] === '{' ? '}' : ']';
  }
  return repaired;
}

/**
 * Trích xuất và phân tích cú pháp chuỗi JSON từ phản hồi của AI.
 * Xử lý được cả trường hợp AI trả về văn bản thừa hoặc bọc trong markdown (```json).
 */
export function extractJson(text: string): any {
  if (!text || typeof text !== 'string') {
    throw new Error("Phản hồi từ AI trống hoặc không hợp lệ.");
  }

  // 1. Loại bỏ markdown code block nếu AI bọc kết quả bên trong (VD: ```json ... ```)
  const markdownRegex = /```(?:json)?\s*([\s\S]*?)\s*```/i;
  const match = text.match(markdownRegex);
  let contentToParse = match ? match[1] : text;

  // 2. Tìm vị trí bắt đầu và kết thúc của JSON (Object hoặc Array)
  const firstBrace = contentToParse.indexOf('{');
  const firstBracket = contentToParse.indexOf('[');
  
  // Xác định điểm bắt đầu hợp lệ (lấy index nhỏ nhất không phải là -1)
  const firstIndex = (firstBrace !== -1 && firstBracket !== -1)
    ? Math.min(firstBrace, firstBracket)
    : Math.max(firstBrace, firstBracket);
    
  const lastBrace = contentToParse.lastIndexOf('}');
  const lastBracket = contentToParse.lastIndexOf(']');
  const lastIndex = Math.max(lastBrace, lastBracket);

  // 3. Cắt đúng chuỗi JSON cần thiết
  if (firstIndex !== -1 && lastIndex !== -1 && lastIndex >= firstIndex) {
    contentToParse = contentToParse.slice(firstIndex, lastIndex + 1);
  }

  // 4. Cố gắng parse chuỗi JSON
  try {
    return JSON.parse(contentToParse);
  } catch (error) {
    // 4b. Rất có thể phản hồi bị cắt cụt do vượt maxOutputTokens (hay gặp với tài
    // liệu/set test case lớn) - thử tự vá lại trước khi báo lỗi hẳn.
    const repaired = repairTruncatedJson(contentToParse);
    if (repaired) {
      try {
        const result = JSON.parse(repaired);
        console.warn(
          "⚠️ [extractJson] Phản hồi AI bị cắt cụt giữa chừng (vượt giới hạn token) - đã tự động phục hồi phần JSON hợp lệ và bỏ phần tử cuối bị dở dang."
        );
        return result;
      } catch {
        // Vá không thành công -> rơi xuống báo lỗi gốc bên dưới.
      }
    }

    console.error("❌ Lỗi Parse JSON:", error);
    console.error("Chuỗi text lỗi:", contentToParse);
    throw new Error("Dữ liệu trả về từ AI không đúng định dạng JSON. Vui lòng thử lại.");
  }
}

/**
 * Groq (OpenAI-compatible) bắt buộc response_format: json_object phải là một
 * JSON OBJECT ở top-level — model không thể trả về bare array trong chế độ này.
 * Vì vậy khi fallback sang Groq, AI sẽ tự bọc mảng test case vào 1 object,
 * VD: {"test_cases": [...]}, {"data": [...]}, {"result": [...]}...
 * Hàm này "gỡ lớp bọc" đó ra để lấy đúng mảng cần validate, tránh việc
 * generatedTestCasesSchema (z.array(...)) fail chỉ vì bị bọc thêm 1 lớp object
 * không do lỗi nội dung AI sinh ra.
 */
export function unwrapArrayResponse(data: any): any {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return data;

  // Ưu tiên các key phổ biến mà LLM hay dùng để bọc mảng.
  const preferredKeys = [
    'test_cases',
    'testCases',
    'test_case',
    'testCase',
    'data',
    'result',
    'results',
    'items',
    'cases',
  ];
  for (const key of preferredKeys) {
    if (Array.isArray(data[key])) return data[key];
  }

  // Không match key quen thuộc -> lấy property đầu tiên có giá trị là mảng.
  const arrayValue = Object.values(data).find((v) => Array.isArray(v));
  if (arrayValue) return arrayValue;

  // Không tìm thấy mảng nào bên trong -> trả nguyên object, để Zod báo lỗi rõ ràng.
  return data;
}

/**
 * Kiểm tra xem một lỗi có đáng để kích hoạt cơ chế Fallback (chuyển sang AI khác) không.
 * Chỉ Fallback khi lỗi thuộc về hạ tầng mạng hoặc giới hạn API (Rate limit, Timeout, 50x...).
 */
export function isFallbackWorthyError(error: any): boolean {
  if (!error) return false;

  const errorMessage = (error.message || '').toLowerCase();
  const errorStatus = error.status || error.statusCode || 500;

  // Danh sách các HTTP Status Code cho thấy server AI đang có vấn đề
  // 429: Too Many Requests (Rate Limit/Quota)
  // 500, 502, 503, 504: Lỗi từ máy chủ AI
  const fallbackStatusCodes = [429, 500, 502, 503, 504];
  if (fallbackStatusCodes.includes(errorStatus)) {
    return true;
  }

  // Kiểm tra bằng các từ khóa lỗi thường gặp trong API của Google và Groq
  const fallbackKeywords = [
    'rate limit',
    'too many requests',
    'quota',
    'exhausted',
    'overloaded',
    'service unavailable',
    'timeout',
    'socket hang up',
    'fetch failed',
    '429',
    '503',
    '504'
  ];

  return fallbackKeywords.some(keyword => errorMessage.includes(keyword));
}