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

  // The response body isn't guaranteed to be our `{ success, ... }` JSON envelope —
  // platform-level failures (e.g. Vercel's 413 "Request Entity Too Large" for a
  // request body over the serverless function limit, or a 502/504 from an upstream
  // timeout) return a plaintext/HTML body that never reaches our route handler.
  // `response.json()` throws a SyntaxError on those, which used to surface to the
  // user as a raw "Unexpected token '...' is not valid JSON" instead of a real
  // message — fall back to the caller's generic message in that case.
  let payload: { success?: boolean; error?: string; details?: ApiErrorDetail[]; data?: T };
  try {
    payload = await response.json();
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
