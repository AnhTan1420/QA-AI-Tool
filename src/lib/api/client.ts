export type ApiErrorDetail = { path: string; message: string };

export type ApiErrorKind = 'timeout' | 'too_large' | 'http';

export class ApiError extends Error {
  details?: ApiErrorDetail[];
  /** HTTP status when the failure came from the transport/platform rather than our handler. */
  status?: number;
  kind?: ApiErrorKind;
}

export type PostJsonOptions = {
  /**
   * Message for a platform-level timeout (502/504/408 whose body is not our JSON envelope —
   * i.e. the serverless function was killed before it could answer). Without it the user only
   * saw a generic "request failed" and assumed the AI had silently stopped.
   */
  timedOutMessage?: string;
  /** Message for HTTP 413 (request body over the platform limit). */
  tooLargeMessage?: string;
};

const PLATFORM_TIMEOUT_STATUSES = new Set([408, 502, 504]);

/**
 * POSTs JSON to `url` and unwraps the app's `{ success, data }` / `{ success, error }`
 * response envelope. Throws an `ApiError` (with optional Zod-style `details`) on failure.
 */
export async function postJson<T>(
  url: string,
  body: unknown,
  requestFailedMessage: (url: string) => string,
  options: PostJsonOptions = {},
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
    // Not our envelope: the platform answered (or the function was killed). Say which.
    const err = new ApiError(requestFailedMessage(url));
    err.status = response.status;
    if (PLATFORM_TIMEOUT_STATUSES.has(response.status) && options.timedOutMessage) {
      err.message = options.timedOutMessage;
      err.kind = 'timeout';
    } else if (response.status === 413 && options.tooLargeMessage) {
      err.message = options.tooLargeMessage;
      err.kind = 'too_large';
    } else {
      err.kind = 'http';
    }
    throw err;
  }

  if (!response.ok || !payload.success) {
    const err = new ApiError(payload.error ?? requestFailedMessage(url));
    err.status = response.status;
    err.kind = 'http';
    if (Array.isArray(payload.details)) err.details = payload.details;
    throw err;
  }
  return payload.data as T;
}
