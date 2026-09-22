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
 * @deprecated KHONG dung cho luong doc tai lieu nua.
 *
 * Ham nay tung duoc goi trong /api/ai/documents/parse va cat thang tai lieu o
 * ky tu thu 24.000, khien moi yeu cau phia sau khong bao gio tro thanh atom —
 * tuc la bang kiem do phu bi khuyet ngay tu goc. Da duoc thay bang
 * services/documents/reader.ts (chia chunk + gop, khong cat cut).
 *
 * Giu lai vi no van la mot tien ich chan do dai hop le cho cac muc dich khac
 * (vd cat log). Dung no cho noi dung tai lieu la mot loi nghiem trong.
 */
export function capText(text: string, maxChars = 24000): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}
