import * as mammoth from 'mammoth';
import pdfParse from 'pdf-parse';

// ============================================================================
// File: text-extractors.ts
// Chuc nang: Trich xuat text tho tu file .docx / .pdf de dua vao Document
// Extraction Agent (lib/ai/prompts/document-extraction-agent.ts). File .md/.txt
// khong can qua day — client doc thang bang File.text() va gui len duoi dang
// `content` (xem hooks/test-case/use-generate-workspace.ts).
// ============================================================================

/** Trich xuat plain text tu buffer cua 1 file .docx (Word). */
export async function extractDocxText(buffer: Buffer): Promise<string> {
  const result = await mammoth.extractRawText({ buffer });
  return result.value.trim();
}

/** Trich xuat plain text tu buffer cua 1 file .pdf. */
export async function extractPdfText(buffer: Buffer): Promise<string> {
  const result = await pdfParse(buffer);
  return (result.text ?? '').trim();
}

/**
 * Gioi han do dai text truoc khi dua vao prompt AI, tranh vuot qua context/
 * budget token cua model chi vi 1 file qua dai. Tra ve ca co bi cat hay khong
 * de route co the ghi chu lai trong `summary` cho nguoi dung biet.
 */
export function capText(text: string, maxChars = 24000): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}
