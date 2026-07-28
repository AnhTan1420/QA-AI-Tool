// ============================================================================
// File: parse.ts
// Chức năng: Tiện ích xử lý dữ liệu trả về từ LLM và phân loại lỗi
// ============================================================================

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
    console.error("❌ Lỗi Parse JSON:", error);
    console.error("Chuỗi text lỗi:", contentToParse);
    throw new Error("Dữ liệu trả về từ AI không đúng định dạng JSON. Vui lòng thử lại.");
  }
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