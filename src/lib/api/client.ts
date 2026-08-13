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
  const payload = await response.json();
  if (!response.ok || !payload.success) {
    const err = new ApiError(payload.error ?? requestFailedMessage(url));
    if (Array.isArray(payload.details)) err.details = payload.details;
    throw err;
  }
  return payload.data as T;
}
