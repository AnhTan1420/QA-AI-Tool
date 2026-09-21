// Minimal ambient typings for the two doc-extraction dependencies used by
// lib/documents/text-extractors.ts (server, via Buffer) and
// lib/utils/docx-client-extract.ts (browser, via ArrayBuffer — mammoth's
// package.json "browser" field swaps in its browser build for that same
// `extractRawText` call, which accepts an `arrayBuffer` input; see mammoth's
// own lib/index.d.ts for the upstream shape this narrows down from). Kept
// intentionally narrow — only the shapes we actually call — so this never
// drifts out of sync with real usage.

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

  export function extractRawText(input: { buffer: Buffer } | { path: string } | { arrayBuffer: ArrayBuffer }): Promise<ExtractRawTextResult>;
}
