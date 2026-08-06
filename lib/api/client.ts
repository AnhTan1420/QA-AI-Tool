export type ApiErrorDetail = { path: string; message: string };

export class ApiError extends Error {
  details?: ApiErrorDetail[];
}

export async function postJson<T>(
  url: string,
  body: unknown,
  fallbackErrorMessage?: string | ((url: string) => string)
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = await response.json();

  if (!response.ok || !payload.success) {
    console.error('API Error:', {
      url,
      status: response.status,
      bodySent: body,
      error: payload.error,
      details: payload.details,
    });
    
    const fallback = typeof fallbackErrorMessage === 'function'
      ? fallbackErrorMessage(url)
      : fallbackErrorMessage;
    
    const err = new ApiError(payload.error ?? fallback ?? 'Request failed');
    if (Array.isArray(payload.details)) err.details = payload.details;
    throw err;
  }

  return payload.data;
}
