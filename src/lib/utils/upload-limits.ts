/**
 * Vercel's Node.js Serverless Functions enforce a hard ~4.5MB limit on the
 * TOTAL request body. This is a platform-level constraint enforced before our
 * route handler even runs — it returns `FUNCTION_PAYLOAD_TOO_LARGE` (HTTP 413)
 * straight from the edge, with a plaintext body, not something `next.config.ts`
 * or any in-app `bodyParser` setting can raise.
 *
 * Base64 inflates a binary file by ~4/3, so any flow that inlines a file as
 * `data_base64` in a JSON body (pdf, diagram_image — see
 * app/api/ai/documents/parse/route.ts) can only safely carry raw files well
 * below that ceiling, leaving headroom for the rest of the JSON payload.
 *
 * .docx is NOT subject to this limit: `extractDocxTextClientSide` (see
 * docx-client-extract.ts) extracts plain text in the browser via mammoth's
 * browser build, and only that (tiny, capped) text is ever sent to the
 * server — the raw .docx bytes never leave the client.
 */
export const MAX_INLINE_BASE64_UPLOAD_BYTES = 3 * 1024 * 1024; // 3 MiB raw file

/** Base64-encoded length a file of `MAX_INLINE_BASE64_UPLOAD_BYTES` produces —
 * use this to bound the `data_base64` string itself (e.g. in a Zod schema). */
export const MAX_INLINE_BASE64_CHARS = Math.ceil(MAX_INLINE_BASE64_UPLOAD_BYTES / 3) * 4;

export function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
