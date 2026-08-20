// ============================================================================
// File: parse.ts
// Chức năng: Tiện ích xử lý dữ liệu trả về từ LLM và phân loại lỗi
// ============================================================================

function repairTruncatedJson(text: string): string | null {
  const openStack: string[] = [];
  let inString = false;
  let escapeNext = false;
  let lastSafeIndex = -1;
  let lastSafeStack: string[] = [];
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
      if (ch === '[') {
        const depth = openStack.length;
        if (itemArrayDepth === null || depth < itemArrayDepth) {
          itemArrayDepth = depth;
          lastSafeIndex = -1;
          lastSafeStack = [];
        }
      }
    } else if (ch === '}' || ch === ']') {
      openStack.pop();
      if (itemArrayDepth !== null && openStack.length === itemArrayDepth) {
        lastSafeIndex = i;
        lastSafeStack = [...openStack];
      }
    }
  }

 
  if (lastSafeIndex === -1 || lastSafeStack.length === 0) return null;

  let repaired = text.slice(0, lastSafeIndex + 1);
  for (let i = lastSafeStack.length - 1; i >= 0; i--) {
    repaired += lastSafeStack[i] === '{' ? '}' : ']';
  }
  return repaired;
}


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
 * Groq (OpenAI-compatible)
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
