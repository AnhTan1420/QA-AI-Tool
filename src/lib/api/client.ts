export type ApiErrorDetail = { path: string; message: string };

export class ApiError extends Error {
  details?: ApiErrorDetail[];
}

/**
 * POSTs JSON to `url` and unwraps the app's `{ success, data }` / `{ success, error }`
 * response envelope. Throws an `ApiError` (with optional Zod-style `details`) on failure.
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  requestFailedMessage: (url: string) => string,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  // Doc body dang TEXT truoc roi moi tu JSON.parse — mot so loi tra ve TRUOC KHI
  // request cham toi route handler cua chung ta (vd 413 "Request Entity Too
  // Large" tu chinh platform hosting khi payload vuot gioi han cung cua
  // serverless function, hoac 502/504 voi trang loi HTML) co body KHONG PHAI
  // JSON. Goi thang response.json() trong truong hop do se nem ra 1 SyntaxError
  // rat kho hieu doi voi nguoi dung (vd "Unexpected token 'R', "Request En"...
  // is not valid JSON") thay vi 1 thong bao loi ro rang — parse thu cong o day
  // de LUON tra ve 1 ApiError co message de hieu, du server tra ve gi di nua.
  const rawText = await response.text();
  let payload: { success?: boolean; error?: string; details?: ApiErrorDetail[]; data?: unknown };
  try {
    payload = rawText ? JSON.parse(rawText) : {};
  } catch {
    throw new ApiError(requestFailedMessage(url));
  }

  if (!response.ok || !payload.success) {
    const err = new ApiError(payload.error ?? requestFailedMessage(url));
    if (Array.isArray(payload.details)) err.details = payload.details;
    throw err;
  }
  return payload.data as T;
}
