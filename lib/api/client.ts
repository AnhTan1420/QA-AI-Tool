export type ApiErrorDetail = { path: string; message: string };

export class ApiError extends Error {
  details?: ApiErrorDetail[];
}

// lib/api/client.ts
export async function postJson<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  const payload = await response.json();

  if (!response.ok || !payload.success) {
    // LOG CHI TIẾT RA CONSOLE ĐỂ DEBUG
    console.error('API Error:', {
      url,
      status: response.status,
      bodySent: body,
      error: payload.error,
      details: payload.details, // Zod error details
    });
    const err = new ApiError(payload.error ?? 'Request failed');
    if (Array.isArray(payload.details)) err.details = payload.details;
    throw err;
  }

  return payload.data;
}
