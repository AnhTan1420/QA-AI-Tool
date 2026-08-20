// Minimal ambient typings for the two doc-extraction dependencies used by
// lib/documents/text-extractors.ts. Kept intentionally narrow — only the
// shape we actually call — so this never drifts out of sync with real usage.

declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string;
    numpages: number;
    numrender: number;
    info: Record<string, unknown>;
    metadata: unknown;
    version: string;
  }

  function pdfParse(dataBuffer: Buffer | Uint8Array, options?: Record<string, unknown>): Promise<PdfParseResult>;

  export default pdfParse;
}

declare module 'mammoth' {
  interface ExtractRawTextResult {
    value: string;
    messages: unknown[];
  }

  export function extractRawText(input: { buffer: Buffer } | { path: string }): Promise<ExtractRawTextResult>;
}
