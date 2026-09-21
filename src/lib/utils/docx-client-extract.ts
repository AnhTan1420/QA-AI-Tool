import * as mammoth from 'mammoth';

/**
 * Extracts raw text from a .docx File ENTIRELY in the browser.
 *
 * Why: mammoth ships a browser build (see its package.json `browser` field,
 * which webpack/Next.js picks up automatically for client bundles) that reads
 * from an ArrayBuffer instead of Node's `fs`/`Buffer` — the same API already
 * used server-side in services/documents/text-extractors.ts#extractDocxText,
 * just fed an in-memory ArrayBuffer instead of a Buffer.
 *
 * This is what actually fixes the 413 FUNCTION_PAYLOAD_TOO_LARGE on
 * /api/ai/documents/parse for large .docx files: previously the whole file was
 * base64-encoded and inlined in the JSON request body, which for anything
 * above a few MB blows past Vercel's hard ~4.5MB serverless request-body limit
 * (see upload-limits.ts) — a platform limit no server-side change can raise.
 * By extracting here, only the (small, already `capText`-bounded server-side)
 * plain text ever crosses the network, regardless of how large — or how many
 * embedded images are in — the original .docx.
 */
export async function extractDocxTextClientSide(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer });
  return result.value.trim();
}
