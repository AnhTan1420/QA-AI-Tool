/**
 * postJson: a serverless function killed by the platform must read as "timed
 * out / work kept", not as an anonymous "request failed" (which users read as
 * "the AI silently stopped").
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { ApiError, postJson } from '@/lib/api/client';

const generic = (url: string) => `GENERIC:${url}`;

/** Awaits a promise that MUST reject and returns the typed error (fails if it unexpectedly resolves). */
async function rejection(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('expected the request to reject');
}
const options = { timedOutMessage: 'TIMED_OUT', tooLargeMessage: 'TOO_LARGE' };

function respond(status: number, body: string, contentType = 'text/html') {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status, headers: { 'content-type': contentType } })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('postJson failure classification', () => {
  it.each([504, 502, 408])('a platform %i with a non-JSON body is reported as a TIMEOUT with the specific message', async (status) => {
    respond(status, '<html>An error occurred with your deployment FUNCTION_INVOCATION_TIMEOUT</html>');
    const error = await rejection(postJson('/api/ai/generate', {}, generic, options));
    expect(error).toBeInstanceOf(ApiError);
    expect(error.kind).toBe('timeout');
    expect(error.message).toBe('TIMED_OUT');
    expect(error.status).toBe(status);
  });

  it('HTTP 413 is reported as too-large', async () => {
    respond(413, 'Request Entity Too Large');
    const error = await rejection(postJson('/x', {}, generic, options));
    expect(error.kind).toBe('too_large');
    expect(error.message).toBe('TOO_LARGE');
  });

  it('without the options (the ~10 other call sites) the old generic message is unchanged', async () => {
    respond(504, '<html>timeout</html>');
    const error = await rejection(postJson('/api/other', {}, generic));
    expect(error.message).toBe('GENERIC:/api/other');
    expect(error.kind).toBe('http');
  });

  it('our own JSON error envelope keeps its server message (e.g. a 503 provider error)', async () => {
    respond(503, JSON.stringify({ success: false, error: 'Gemini đang quá tải' }), 'application/json');
    const error = await rejection(postJson('/api/ai/generate', {}, generic, options));
    expect(error.message).toBe('Gemini đang quá tải');
    expect(error.status).toBe(503);
    expect(error.kind).toBe('http');
  });

  it('carries Zod-style details through unchanged', async () => {
    respond(400, JSON.stringify({ success: false, error: 'bad', details: [{ path: ['x'], message: 'm' }] }), 'application/json');
    const error = await rejection(postJson('/x', {}, generic, options));
    expect(error.details).toEqual([{ path: ['x'], message: 'm' }]);
  });

  it('unwraps data on success', async () => {
    respond(200, JSON.stringify({ success: true, data: { n: 1 } }), 'application/json');
    await expect(postJson<{ n: number }>('/x', {}, generic, options)).resolves.toEqual({ n: 1 });
  });

  it('never retries by itself: exactly ONE fetch per call (retry ownership: the client does not retry)', async () => {
    const fetchMock = vi.fn(async () => new Response('<html>timeout</html>', { status: 504 }));
    vi.stubGlobal('fetch', fetchMock);
    await postJson('/api/ai/generate', {}, generic, options).catch(() => undefined);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
