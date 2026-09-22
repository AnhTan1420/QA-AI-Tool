// ============================================================================
// File: src/services/documents/reader.ts
// DOC TAI LIEU DAY DU — khong cat cut, nhieu luot.
// ----------------------------------------------------------------------------
// Loi cu: `capText(text, 24000)` cat thang tai lieu o ky tu thu 24.000 roi
// ghi chu mot dong trong summary. Hau qua khong phai la "mat mot chut chi
// tiet" — la BANG KIEM ATOM BI KHUYET. Moi thu phia sau (coverage, repair,
// review, enhance) deu do bang inventory do, nen he thong se bao "126/126 =
// 100%" trong khi 126 do chi la phan dau cua tai lieu. Do phu 100% cua mot su
// that bi cat cut la con so nguy hiem hon 32.5% trung thuc.
//
// Kien truc moi:
//      text day du
//        → chunk theo ranh gioi doan/heading (co phan chong lan)
//        → PASS 1: trich atom cho tung chunk (song song co gioi han)
//        → PASS 2: audit do day du tren tung chunk (tuy chon, mac dinh bat)
//        → gop + khu trung + on dinh hoa atom_id
// ============================================================================

import { runAIAgent } from '@/services/ai/provider';
import {
  buildDocumentCompletenessAuditPrompt,
  buildTextDocumentExtractionPrompt,
} from '@/services/ai/prompts/document-extraction-agent';
import { documentExtractionResultSchema, type DocumentAtom } from '@/models/validators/document';
import { normalizeForMatch } from './coverage-evidence';

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Kich thuoc 1 chunk van ban gui cho Gemini (ky tu). */
export function getReaderChunkChars(): number {
  return readIntEnv('AI_READER_CHUNK_CHARS', 18_000, 4_000, 60_000);
}

/** Phan chong lan giua 2 chunk lien tiep, de 1 rule bi cat doi khong mat. */
export function getReaderChunkOverlapChars(): number {
  return readIntEnv('AI_READER_CHUNK_OVERLAP_CHARS', 1_200, 0, 10_000);
}

/** Tran cung so chunk — chan tai lieu bat thuong lam no chi phi. */
export function getReaderMaxChunks(): number {
  return readIntEnv('AI_READER_MAX_CHUNKS', 24, 1, 200);
}

export function isReaderAuditPassEnabled(): boolean {
  const raw = process.env.AI_READER_AUDIT_PASS?.trim().toLowerCase();
  return raw !== 'false' && raw !== '0' && raw !== 'off';
}

export type TextChunk = { index: number; total: number; text: string };

/**
 * Chia van ban thanh cac chunk, uu tien cat o ranh gioi TU NHIEN (dong trong,
 * xuong dong, dau cau) thay vi giua mot cau — mot rule bi cat doi o giua se
 * sinh ra 2 atom nua voi o 2 chunk khac nhau.
 */
export function chunkDocumentText(
  text: string,
  options: { maxChars?: number; overlapChars?: number; maxChunks?: number } = {},
): TextChunk[] {
  const maxChars = options.maxChars ?? getReaderChunkChars();
  const overlap = Math.min(options.overlapChars ?? getReaderChunkOverlapChars(), Math.floor(maxChars / 3));
  const maxChunks = options.maxChunks ?? getReaderMaxChunks();

  const trimmed = text.trim();
  if (trimmed.length === 0) return [];
  if (trimmed.length <= maxChars) return [{ index: 1, total: 1, text: trimmed }];

  const pieces: string[] = [];
  let cursor = 0;

  while (cursor < trimmed.length && pieces.length < maxChunks) {
    const hardEnd = Math.min(cursor + maxChars, trimmed.length);

    let end = hardEnd;
    if (hardEnd < trimmed.length) {
      // Tim ranh gioi tu nhien gan nhat, chi trong 25% cuoi cua chunk — de khong
      // tao ra mot chunk ti hon chi vi co 1 dong trong o ngay dau.
      const windowStart = cursor + Math.floor(maxChars * 0.75);
      const candidates = [
        trimmed.lastIndexOf('\n\n', hardEnd),
        trimmed.lastIndexOf('\n', hardEnd),
        trimmed.lastIndexOf('. ', hardEnd),
      ].filter((i) => i > windowStart);
      if (candidates.length > 0) end = Math.max(...candidates);
    }

    pieces.push(trimmed.slice(cursor, end).trim());
    if (end >= trimmed.length) break;
    cursor = Math.max(end - overlap, cursor + 1);
  }

  return pieces
    .filter((p) => p.length > 0)
    .map((text, i, all) => ({ index: i + 1, total: all.length, text }));
}

/** Khoa khu trung theo NOI DUNG (khong theo id) — 2 chunk chong lan se sinh
 * cung mot rule voi 2 id khac nhau, va do la trung lap that su. */
function contentKey(atom: DocumentAtom): string {
  return `${normalizeForMatch(atom.label).replace(/\s+/g, ' ').trim()}⁞${normalizeForMatch(atom.detail)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180)}`;
}

/**
 * Gop atom tu nhieu luot: khu trung theo noi dung, va bao dam atom_id duy nhat
 * (chunk khac nhau co the vo tinh dung cung id).
 */
export function mergeAtoms(batches: DocumentAtom[][]): { atoms: DocumentAtom[]; duplicates_removed: number } {
  const byContent = new Map<string, DocumentAtom>();
  const usedIds = new Set<string>();
  const result: DocumentAtom[] = [];
  let duplicates = 0;

  for (const batch of batches) {
    for (const atom of batch) {
      if (!atom?.atom_id || !atom.label || !atom.detail) continue;

      const key = contentKey(atom);
      if (byContent.has(key)) {
        duplicates++;
        continue;
      }

      let id = atom.atom_id.trim();
      if (usedIds.has(id)) {
        let suffix = 2;
        while (usedIds.has(`${id}_${suffix}`)) suffix++;
        id = `${id}_${suffix}`;
      }
      usedIds.add(id);

      const normalized = { ...atom, atom_id: id };
      byContent.set(key, normalized);
      result.push(normalized);
    }
  }

  return { atoms: result, duplicates_removed: duplicates };
}

export type ReaderResult = {
  title: string;
  summary: string;
  atoms: DocumentAtom[];
  stats: {
    source_chars: number;
    chunks: number;
    atoms_first_pass: number;
    atoms_from_audit: number;
    duplicates_removed: number;
    failed_chunks: number;
  };
  warnings: string[];
};

/** Goi Gemini cho 1 prompt trich xuat va tra ve atom, hoac null neu that bai. */
async function extractAtoms(prompt: string, label: string): Promise<{ title?: string; summary?: string; atoms: DocumentAtom[] } | null> {
  try {
    const raw = await runAIAgent(prompt, 'document_extraction');
    const parsed = documentExtractionResultSchema.safeParse(raw);
    if (parsed.success) return parsed.data;

    // Audit pass duoc phep tra ve 0 atom (nghia la "khong sot gi"), nhung
    // documentExtractionResultSchema yeu cau atoms.min(1) + title/summary. Chap
    // nhan rieng hinh dang toi thieu { atoms: [...] } de khong vut bo ket qua hop le.
    const loose = raw as { atoms?: unknown } | null;
    if (loose && Array.isArray(loose.atoms)) {
      const atomsOnly = documentExtractionResultSchema
        .pick({ atoms: true })
        .partial()
        .safeParse({ atoms: loose.atoms });
      if (atomsOnly.success && atomsOnly.data.atoms) return { atoms: atomsOnly.data.atoms };
    }

    console.warn(`[Reader] ${label}: phản hồi sai schema, bỏ qua đoạn này.`, parsed.error.issues.slice(0, 3));
    return null;
  } catch (error) {
    console.warn(`[Reader] ${label}: gọi Gemini thất bại.`, error instanceof Error ? error.message : error);
    return null;
  }
}

/**
 * Doc TOAN BO mot tai lieu van ban thanh atom. Khong cat cut.
 *
 * Loi tren MOT chunk khong lam hong ca tai lieu — ta ghi warning va tiep tuc,
 * vi mot inventory thieu 1 doan van kem theo canh bao ro rang van huu ich hon
 * nhieu so voi loi 502 va khong co gi ca. Nhung so chunk that bai duoc bao cao
 * len tan UI de khong ai nham tuong inventory la day du.
 */
export async function readTextDocument(input: {
  fileName: string;
  text: string;
}): Promise<ReaderResult | null> {
  const chunks = chunkDocumentText(input.text);
  if (chunks.length === 0) return null;

  const warnings: string[] = [];
  const maxChunks = getReaderMaxChunks();
  const estimatedChunks = Math.ceil(input.text.trim().length / getReaderChunkChars());
  if (estimatedChunks > maxChunks) {
    warnings.push(
      `Tài liệu rất dài: chỉ ${maxChunks} phần đầu được phân tích (giới hạn AI_READER_MAX_CHUNKS). Hãy tách tài liệu hoặc tăng giới hạn để phân tích đầy đủ.`,
    );
  }

  let title = input.fileName;
  let summary = '';
  const firstPassBatches: DocumentAtom[][] = [];
  const auditBatches: DocumentAtom[][] = [];
  let failedChunks = 0;

  // Tuan tu chu khong song song: chay song song nhieu chunk se dam thang vao
  // rate limit cua Gemini va bien mot tai lieu dai thanh mot chuoi 429.
  for (const chunk of chunks) {
    const label = `chunk ${chunk.index}/${chunk.total}`;
    const extracted = await extractAtoms(
      buildTextDocumentExtractionPrompt({
        sourceLabel: input.fileName,
        rawText: chunk.text,
        chunkIndex: chunk.index,
        chunkTotal: chunk.total,
      }),
      label,
    );

    if (!extracted) {
      failedChunks++;
      warnings.push(`Không phân tích được phần ${chunk.index}/${chunk.total} của tài liệu.`);
      continue;
    }

    if (chunk.index === 1) {
      title = extracted.title?.trim() || title;
      summary = extracted.summary?.trim() || summary;
    }
    firstPassBatches.push(extracted.atoms);

    if (isReaderAuditPassEnabled()) {
      const audit = await extractAtoms(
        buildDocumentCompletenessAuditPrompt({
          sourceLabel: input.fileName,
          rawText: chunk.text,
          existingAtoms: extracted.atoms.map((a) => ({ atom_id: a.atom_id, label: a.label })),
          chunkIndex: chunk.index,
          chunkTotal: chunk.total,
        }),
        `${label} audit`,
      );
      if (audit) auditBatches.push(audit.atoms);
    }
  }

  const firstPassCount = firstPassBatches.reduce((n, b) => n + b.length, 0);
  const merged = mergeAtoms([...firstPassBatches, ...auditBatches]);
  if (merged.atoms.length === 0) return null;

  const auditContribution = merged.atoms.length - new Set(firstPassBatches.flat().map(contentKey)).size;

  return {
    title,
    summary: summary || `Tài liệu "${title}" — ${merged.atoms.length} yêu cầu có thể kiểm thử.`,
    atoms: merged.atoms,
    stats: {
      source_chars: input.text.trim().length,
      chunks: chunks.length,
      atoms_first_pass: firstPassCount,
      atoms_from_audit: Math.max(0, auditContribution),
      duplicates_removed: merged.duplicates_removed,
      failed_chunks: failedChunks,
    },
    warnings,
  };
}
