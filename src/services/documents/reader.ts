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

import { runGeminiTask } from '@/services/ai/provider';
import {
  buildDocumentCompletenessAuditPrompt,
  buildTextDocumentExtractionPrompt,
} from '@/services/ai/prompts/document-extraction-agent';
import { documentExtractionResultSchema, type DocumentAtom } from '@/models/validators/document';
import { normalizeForMatch } from './coverage-evidence';
import { GeminiBadResponseError, GeminiProviderError } from '@/services/ai/errors';

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/** Kich thuoc 1 chunk van ban gui cho Gemini (ky tu). */
export function getReaderChunkChars(): number {
  return readIntEnv('AI_READER_CHUNK_CHARS', 18_000, 400, 60_000);
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

// ============================================================================
// NGAN SACH THOI GIAN (wall-clock budget) — bai hoc tu su co that:
// ----------------------------------------------------------------------------
// Truoc ban sua nay, readTextDocument() lap qua tung chunk ma KHONG HE biet
// route dang chay trong bao nhieu giay tong cong. Ket qua thuc te: 1 tai lieu
// can 2 chunk, chunk thu 2 gap 1 model dang qua tai (503) va ban resilient
// engine hop ly retry 3 lan + doi model — nhung tong thoi gian do (~64s) cong
// voi chunk 1 (~48s) VUOT QUA maxDuration cua chinh serverless function. Vercel
// giet function GIUA CHUNG, va TOAN BO atom da trich duoc tu chunk 1 (da thanh
// cong) bi mat trang — khong co response nao tra ve nguoi dung ca, chu dung noi
// la mot canh bao "chua doc het". Day la that bai NGHIEM TRONG HON ca truong
// hop cu capText(24000): it nhat capText tra ve mot ket qua (du cat cut) thay
// vi khong tra ve gi.
//
// Sua: theo doi 1 deadline tu dau ham, truoc moi chunk kiem tra con du thoi
// gian khong (toi thieu du cho 1 attempt nhanh + margin xu ly), neu khong thi
// DUNG LAI CO KIEM SOAT va tra ve nhung gi da co kem canh bao ro rang — giong
// het nguyen tac da ap dung cho vong coverage-repair (dung khi khong con tien
// trien) va cho GeminiTruncatedResponseError (giu ban va duoc thay vi mat het).
// ============================================================================

/**
 * Tong ngan sach thoi gian (ms) cho CA HAM readTextDocument, tinh tu luc bat
 * dau chunk dau tien. Mac dinh 260s: du cho maxDuration=300s cua route con
 * ~40s du phong cho fetch file/parse input/serialize response.
 */
export function getReaderTotalBudgetMs(): number {
  return readIntEnv('AI_READER_TOTAL_BUDGET_MS', 260_000, 20_000, 900_000);
}

/**
 * Timeout MOI ATTEMPT danh rieng cho Reader — CO CHU DICH nho hon
 * GEMINI_REQUEST_TIMEOUT_MS toan cuc (60s). Reader can di qua NHIEU chunk, moi
 * chunk lai co the can di qua NHIEU model trong chain khi gap loi tam thoi —
 * timeout dai cho tung attempt la thu xa xi Reader khong co: thoi gian danh
 * cho 1 attempt "cham" la thoi gian lay tu chunk khac chua duoc xu ly.
 */
export function getReaderRequestTimeoutMs(): number {
  return readIntEnv('AI_READER_REQUEST_TIMEOUT_MS', 30_000, 5_000, 120_000);
}

/**
 * So lan retry MOI MODEL danh rieng cho Reader — mac dinh 1 (thay vi 2 o cau
 * hinh toan cuc). Su co thuc te cho thay 3 attempt tren CUNG 1 model
 * (gemini-3.5-flash) da an het 64 giay truoc khi engine chiu doi sang model ke
 * tiep. Voi kien truc nhieu-chunk, uu tien "di qua het cac model NHANH" hon la
 * "kien tri voi 1 model". Nguoi van co the tang lai qua env neu can.
 */
export function getReaderMaxRetriesPerModel(): number {
  return readIntEnv('AI_READER_MAX_RETRIES_PER_MODEL', 1, 0, 5);
}

/** Thoi gian toi thieu con lai de con dang thu 1 lan goi nua (attempt + margin xu ly). */
const MIN_TIME_FOR_ONE_ATTEMPT_MS = 8_000;

class ReaderBudget {
  private readonly deadline: number;
  constructor(totalMs: number) {
    this.deadline = Date.now() + totalMs;
  }
  remainingMs(): number {
    return this.deadline - Date.now();
  }
  hasTimeForAnotherCall(): boolean {
    return this.remainingMs() >= MIN_TIME_FOR_ONE_ATTEMPT_MS;
  }
  /** Timeout cho attempt ke tiep: nho hon giua (cau hinh Reader, ngan sach con lai - margin). */
  timeoutForNextCall(): number {
    const configured = getReaderRequestTimeoutMs();
    const safe = Math.max(1_000, this.remainingMs() - 2_000);
    return Math.min(configured, safe);
  }
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
async function extractAtoms(
  prompt: string,
  label: string,
  overrides: { timeoutMs?: number; maxRetriesPerModel?: number } = {},
): Promise<{ title?: string; summary?: string; atoms: DocumentAtom[] } | null> {
  try {
    const result = await runGeminiTask({
      task: 'document_extraction',
      prompt,
      label,
      timeoutMs: overrides.timeoutMs,
      maxRetriesPerModel: overrides.maxRetriesPerModel,
      // Validate LONG TAY thay vi de runGeminiTask ep kieu — audit pass duoc
      // phep tra ve 0 atom (nghia la "khong sot gi") va documentExtractionResultSchema
      // yeu cau atoms.min(1) + title/summary, nen o day tu chap nhan ca hinh
      // dang toi thieu { atoms: [...] } thay vi de bi coi la loi va bi retry oan.
      //
      // QUAN TRONG: khi ca 2 cach parse deu that bai, phai nem GeminiBadResponseError
      // (khong phai Error thuong) — day la loai loi ma classifyGeminiError() nhan
      // dien la 'bad_response' va cho retry/doi model dung cach. Mot Error thuong
      // se roi vao nhanh phan loai 'fatal' MOT CACH TINH CO (dung hanh vi, sai
      // chu dich khai bao) — de nguyen tac ro rang hon la dua vao trung hop.
      validate: (raw: unknown) => {
        const parsed = documentExtractionResultSchema.safeParse(raw);
        if (parsed.success) return parsed.data;

        const loose = raw as { atoms?: unknown } | null;
        if (loose && Array.isArray(loose.atoms)) {
          const atomsOnly = documentExtractionResultSchema
            .pick({ atoms: true })
            .partial()
            .safeParse({ atoms: loose.atoms });
          if (atomsOnly.success && atomsOnly.data.atoms) return { atoms: atomsOnly.data.atoms };
        }

        const preview = parsed.error.issues
          .slice(0, 5)
          .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
          .join('; ');
        throw new GeminiBadResponseError(`Phản hồi AI cho "${label}" không đúng schema: ${preview}`, parsed.error.issues);
      },
    });
    return result.data;
  } catch (error) {
    if (error instanceof GeminiProviderError) {
      console.warn(`[Reader] ${label}: ${error.userMessage} (models: ${error.meta.attemptedModels.join(', ')})`);
    } else {
      console.warn(`[Reader] ${label}: gọi Gemini thất bại.`, error instanceof Error ? error.message : error);
    }
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
  let chunksProcessed = 0;

  // Ngan sach thoi gian cho TOAN BO ham nay — xem ReaderBudget o tren. Day la
  // phong tuyen CUOI CUNG truoc khi Vercel (hoac bat ky platform serverless
  // nao) tu tay giet function va lam mat het ket qua da co, thay vi de chinh
  // ung dung nhan biet va dung lai co kiem soat.
  const budget = new ReaderBudget(getReaderTotalBudgetMs());
  const retryOverride = { maxRetriesPerModel: getReaderMaxRetriesPerModel() };

  // Tuan tu chu khong song song: chay song song nhieu chunk se dam thang vao
  // rate limit cua Gemini va bien mot tai lieu dai thanh mot chuoi 429.
  for (const chunk of chunks) {
    if (!budget.hasTimeForAnotherCall()) {
      const remaining = chunks.length - chunksProcessed;
      warnings.push(
        `Đã hết ngân sách thời gian sau khi xử lý ${chunksProcessed}/${chunks.length} phần — còn ${remaining} phần chưa được phân tích. Tăng AI_READER_TOTAL_BUDGET_MS, hoặc tách tài liệu thành các phần nhỏ hơn và tải lên riêng để phân tích đầy đủ.`,
      );
      console.warn(
        `[Reader] "${input.fileName}": hết ngân sách thời gian sau ${chunksProcessed}/${chunks.length} chunk — dừng có kiểm soát thay vì để function bị nền tảng buộc dừng giữa chừng.`,
      );
      break;
    }

    const label = `chunk ${chunk.index}/${chunk.total}`;
    const extracted = await extractAtoms(
      buildTextDocumentExtractionPrompt({
        sourceLabel: input.fileName,
        rawText: chunk.text,
        chunkIndex: chunk.index,
        chunkTotal: chunk.total,
      }),
      label,
      { timeoutMs: budget.timeoutForNextCall(), ...retryOverride },
    );
    chunksProcessed++;

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

    // Audit pass CHI chay neu con du ngan sach cho no — bo qua co canh bao ro
    // rang thay vi am tham chay va co the la nguyen nhan lam function het gio
    // giua chung o MOT chunk sau nay.
    if (isReaderAuditPassEnabled()) {
      if (!budget.hasTimeForAnotherCall()) {
        warnings.push(
          `Đã bỏ qua lượt audit độ đầy đủ cho phần ${chunk.index}/${chunk.total} vì sắp hết ngân sách thời gian.`,
        );
      } else {
        const audit = await extractAtoms(
          buildDocumentCompletenessAuditPrompt({
            sourceLabel: input.fileName,
            rawText: chunk.text,
            existingAtoms: extracted.atoms.map((a) => ({ atom_id: a.atom_id, label: a.label })),
            chunkIndex: chunk.index,
            chunkTotal: chunk.total,
          }),
          `${label} audit`,
          { timeoutMs: budget.timeoutForNextCall(), ...retryOverride },
        );
        if (audit) auditBatches.push(audit.atoms);
      }
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
      // chunks DA XU LY, khong phai tong so chunk du kien — neu ngan sach het
      // giua chung, con so nay phai phan anh dung nhung gi THAT SU chay, con
      // canh bao ben tren da neu ro tong so con thieu.
      chunks: chunksProcessed,
      atoms_first_pass: firstPassCount,
      atoms_from_audit: Math.max(0, auditContribution),
      duplicates_removed: merged.duplicates_removed,
      failed_chunks: failedChunks,
    },
    warnings,
  };
}
