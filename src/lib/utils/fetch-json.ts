/**
 * Vercel/Next can return a non-JSON body on a hard failure (function crash,
 * timeout -> HTML error page, empty body) - res.json() throws a cryptic
 * "unexpected character at line 1 column 1" in that case. Read as text first
 * so callers can surface something readable instead.
 */
export async function parseJsonResponse(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      text
        ? `Server trả về phản hồi không hợp lệ (HTTP ${res.status}): ${text.slice(0, 200)}`
        : `Server không phản hồi (HTTP ${res.status}) - có thể function đã crash hoặc timeout.`,
    );
  }
}
