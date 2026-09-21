// ============================================================================
// File: parse.ts
// Chức năng: Tiện ích bóc tách + validate dữ liệu JSON trả về từ Gemini.
// ============================================================================

import { GeminiBadResponseError } from './errors';

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
    throw new GeminiBadResponseError("Phản hồi từ AI trống hoặc không hợp lệ.");
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

    // KHONG log `contentToParse`: phan hoi AI co the chua nguyen van noi dung
    // tai lieu nghiep vu nguoi dung vua upload (FS, ERD, thiet ke Figma...).
    console.error("❌ Lỗi Parse JSON từ phản hồi AI:", error instanceof Error ? error.message : error);
    throw new GeminiBadResponseError(
      "Dữ liệu trả về từ AI không đúng định dạng JSON."
    );
  }
}

/**
 * Boc mang test case ra khoi object bao ngoai. Gemini (ke ca khi dung structured
 * output) co the tra ve `{ test_cases: [...] }`, `{ data: [...] }` hoac chinh
 * mang do tuy prompt/che do — ham nay chuan hoa ve mot mang duy nhat.
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
 * Validate 1 phan hoi AI bang Zod va bien loi thanh `GeminiBadResponseError`.
 *
 * Vi sao phai boc lai thay vi de ZodError tu nhien: engine trong gemini.ts phan
 * loai loi de quyet dinh retry. ZodError thuan tuy bi xep vao "fatal" (khong
 * retry, khong doi model) — trong khi that ra mot lan sample khac cua CUNG model
 * rat co the tra ve JSON dung schema. Boc thanh bad_response de no duoc retry.
 */
// Kieu CAU TRUC thay vi `ZodType<T>`: cac schema trong du an dung z.preprocess/
// .default() nen kieu Input va Output khac nhau, khien `ZodType<T>` khong khop.
// Ta chi can den `safeParse` + `issues`, nen khai bao dung phan do cho on dinh.
type AIJsonParseOutcome<T> =
  | { success: true; data: T }
  | { success: false; error: { issues: { path: (string | number)[]; message: string }[] } };

export function validateAIJson<T>(
  schema: { safeParse: (value: unknown) => AIJsonParseOutcome<T> },
  value: unknown,
  label: string,
): T {
  const parsed = schema.safeParse(value);
  if (parsed.success) return parsed.data;

  const preview = parsed.error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');

  throw new GeminiBadResponseError(
    `Phản hồi AI cho "${label}" không đúng schema: ${preview}`,
    parsed.error.issues,
  );
}
