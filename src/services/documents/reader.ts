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

import { createHash } from 'crypto';
import { runGeminiTask } from '@/services/ai/provider';
import type { GeminiThinkingLevel } from '@/services/ai/gemini';
import { getModelChain } from '@/services/ai/model-registry';
import {
  runResumableJob,
  StepInterruptedError,
  type Handoff,
  type StopReason,
} from '@/services/ai/resumable-job';
import {
  buildDocumentCompletenessAuditPrompt,
  buildTextDocumentExtractionPrompt,
} from '@/services/ai/prompts/document-extraction-agent';
import {
  documentExtractionResultSchema,
  type DocumentAtom,
  type ReaderChunkState,
  type ReaderCheckpoint,
  type ReaderStepRecord,
} from '@/models/validators/document';
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
 * Timeout MOI ATTEMPT danh rieng cho Reader (mac dinh 60s).
 *
 * Tung la 30s ("cang ngan cang nhanh qua het model") — SAI: su co thuc te ghi
 * nhan 1 chunk KHOE MANH van mat ~48s (18.000 ky tu vao, hang chuc atom JSON
 * ra). Tran 30s nam DUOI do tre binh thuong, nen moi attempt tren model du
 * phong bi abort giua chung, roi retry lai voi dung 30s do va bi abort tiep:
 * ca chunk that bai chac chan, khong lien quan toi viec model co on hay khong.
 * Nay dung 60s (bang tran toan cuc), con viec "khong doi vo ich" duoc lam boi
 * `retryOnTimeout: false` (khong retry cung model sau timeout) + circuit
 * breaker + chay song song — khong phai bang cach cat ngan timeout.
 */
export function getReaderRequestTimeoutMs(): number {
  return readIntEnv('AI_READER_REQUEST_TIMEOUT_MS', 60_000, 5_000, 120_000);
}

/**
 * So chunk doc DONG THOI (mac dinh 3). Chay tuan tu la ly do 1 tai lieu ~62k
 * ky tu (4 chunk, moi chunk 1 lan trich + 1 lan audit = 8 lan goi, moi lan
 * 30-50s) khong the vua ngan sach 260s NGAY CA khi Gemini hoan toan khoe.
 * Dat 1 de quay lai hanh vi tuan tu (vd khi bi rate-limit 429 o goi free).
 */
export function getReaderConcurrency(): number {
  return readIntEnv('AI_READER_CONCURRENCY', 3, 1, 8);
}

/**
 * Muc thinking cua Reader (mac dinh 'low'). Trich atom la tac vu co hoc, khong
 * can suy luan sau; gemini-3.5-flash mac dinh 'medium' lam moi chunk cham them
 * ma khong tang chat luong dang ke. AI_READER_THINKING_LEVEL=default de dung
 * mac dinh cua model. KHONG cho phep 'minimal' — loi o Gemini 3.7/3.8 Flash.
 */
export function getReaderThinkingLevel(): GeminiThinkingLevel | undefined {
  const raw = process.env.AI_READER_THINKING_LEVEL?.trim().toLowerCase();
  if (raw === 'default' || raw === 'off' || raw === 'none') return undefined;
  if (raw === 'medium' || raw === 'high') return raw;
  return 'low';
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

/**
 * So lan that bai LIEN TIEP truoc khi 1 agent (model) bi HA CAP — cac chunk sau
 * bo qua no va di thang agent ke tiep (mac dinh 2). 1 = ha cap ngay lan hong dau
 * tien; tang len neu model chinh hay "giat" nhung nhanh chong tu khoi.
 */
export function getAgentDemoteAfter(): number {
  return readIntEnv('AI_AGENT_DEMOTE_AFTER', 2, 1, 10);
}

/**
 * Sau bao lau 1 agent bi ha cap duoc THU LAI (failback, mac dinh 60s). Ngan = mau
 * quay lai model chinh nhung de tra chi phi that bai; dai = o lai model phu lau hon.
 */
export function getAgentCooldownMs(): number {
  return readIntEnv('AI_AGENT_COOLDOWN_MS', 60_000, 5_000, 600_000);
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

/**
 * Phien ban prompt/cach trich atom. TANG khi doi prompt hoac dinh dang state: no
 * nam trong hash cua tung chunk nen checkpoint cu tu dong het hieu luc thay vi
 * bi dung nham voi ket qua cua mot prompt khac.
 */
export const READER_PROMPT_VERSION = 1;

/** Dau van tay cua DAU VAO 1 chunk — checkpoint chi hop le neu hash khop. */
export function chunkStepHash(fileName: string, chunk: TextChunk): string {
  return createHash('sha256')
    .update(`${READER_PROMPT_VERSION}\n${fileName}\n${chunk.index}/${chunk.total}\n${chunk.text}`)
    .digest('hex')
    .slice(0, 16);
}

/** Su kien phat ra TRONG luc doc — route stream chung ve client de resume duoc neu bi giet giua chung. */
export type ReaderEvent =
  | { type: 'checkpoint'; step_id: string; record: ReaderStepRecord }
  | ({ type: 'handoff' } & Handoff)
  | { type: 'progress'; completed: number; total: number }
  | { type: 'agent_demoted'; agent: string }
  | { type: 'agent_restored'; agent: string };

export type ReaderJobInfo = {
  status: 'completed' | 'partial';
  stop_reason: StopReason;
  total_steps: number;
  completed_steps: number;
  resumed_steps: number;
  /** Cac chunk chua hoan tat (dang do / that bai / chua chay) — se duoc lam tiep khi resume. */
  pending_step_ids: string[];
  handoffs: Handoff[];
  /** Thu tu agent (model) da cau hinh: [0] la primary. */
  agents: string[];
  checkpoint: ReaderCheckpoint;
};

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
    resumed_chunks: number;
    agent_handoffs: number;
    pending_chunks: number;
  };
  warnings: string[];
  job: ReaderJobInfo;
};

type ExtractedChunk = NonNullable<ReaderChunkState['extracted']>;

/**
 * Nem khi TAT CA chunk deu that bai vi Gemini khong kha dung (khong chunk nao
 * thanh cong). Khac `null` (= Gemini tra loi binh thuong nhung khong tim thay
 * atom nao): day la loi tam thoi, thu lai sau la duoc, khong phai loi file.
 */
export class ReaderProviderUnavailableError extends Error {
  readonly name = 'ReaderProviderUnavailableError';
  constructor(readonly meta: { failedChunks: number; totalChunks: number; skippedChunks: number }) {
    super('Gemini không khả dụng trên tất cả model — Reader không đọc được phần nào của tài liệu.');
  }

  get userMessage(): string {
    return 'Gemini đang quá tải hoặc phản hồi quá chậm nên chưa đọc được tài liệu (không phải lỗi của file). Vui lòng thử lại sau vài phút.';
  }
}

/**
 * Goi 1 agent (= 1 model, GHIM chuoi model = [agent]) cho 1 prompt trich xuat.
 * NEM khi that bai — viec doi agent la cua runResumableJob, khong phai cua engine:
 * nho vay runner biet agent nao vua hong, va ban giao duoc trang thai dang do.
 */
async function extractAtoms(
  prompt: string,
  label: string,
  options: { agent: string; timeoutMs?: number; maxRetriesPerModel?: number },
): Promise<{ data: ExtractedChunk; truncated: boolean }> {
  try {
    const result = await runGeminiTask({
      task: 'document_extraction',
      prompt,
      label,
      models: [options.agent],
      timeoutMs: options.timeoutMs,
      maxRetriesPerModel: options.maxRetriesPerModel,
      thinkingLevel: getReaderThinkingLevel(),
      // Timeout o T giay thi thu lai voi cung T giay gan nhu chac chan timeout
      // lai — sang ngay agent ke tiep (xem GeminiCallOptions.retryOnTimeout).
      retryOnTimeout: false,
      // Validate LONG TAY thay vi de runGeminiTask ep kieu — audit pass duoc
      // phep tra ve 0 atom (nghia la "khong sot gi") va documentExtractionResultSchema
      // yeu cau atoms.min(1) + title/summary, nen o day tu chap nhan ca hinh
      // dang toi thieu { atoms: [...] } thay vi de bi coi la loi va bi retry oan.
      //
      // QUAN TRONG: khi ca 2 cach parse deu that bai, phai nem GeminiBadResponseError
      // (khong phai Error thuong) — day la loai loi ma classifyGeminiError() nhan
      // dien la 'bad_response' va cho retry dung cach.
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
    return { data: result.data, truncated: result.truncated };
  } catch (error) {
    if (error instanceof GeminiProviderError) {
      console.warn(`[Reader] ${label} @ ${options.agent}: ${error.userMessage}`);
    } else {
      console.warn(`[Reader] ${label} @ ${options.agent}: gọi Gemini thất bại.`, error instanceof Error ? error.message : error);
    }
    throw error;
  }
}

function isProviderUnavailable(error: unknown): boolean {
  if (!(error instanceof GeminiProviderError)) return false;
  return error.meta.lastKind === 'transient' || error.meta.lastKind === 'model_unavailable';
}

/**
 * Doc TOAN BO mot tai lieu van ban thanh atom. Khong cat cut.
 *
 * AGENT FALLBACK & JOB RESUMPTION (services/ai/resumable-job.ts):
 *  • Moi chunk la 1 STEP co hash dau vao, 2 pha: (1) trich atom, (2) audit do
 *    day du. Danh sach model cau hinh la danh sach AGENT: primary → secondary...
 *  • Agent chinh loi / bi force-stop (503, timeout, crash) -> agent phu NHAN LAI
 *    dung chunk do, va neu pha 1 da xong thi chi lam pha 2 (khong lam lai tu dau).
 *  • Agent bi hong lien tiep bi ha cap: cac chunk sau di thang agent phu thay vi
 *    tra lai chi phi that bai; het cooldown thi thu lai agent chinh (failback).
 *  • Moi checkpoint duoc phat qua `onEvent` NGAY khi co. `resume` nhan checkpoint
 *    cua lan doc truoc: chunk da xong khong bi goi lai Gemini, chunk dang do
 *    duoc lam tiep — ke ca khi tien trinh cu bi nen tang giet giua chung.
 *
 * Loi tren MOT chunk khong lam hong ca tai lieu: ta ghi warning va tiep tuc,
 * ket qua thieu duoc bao cao ro (failed/pending chunks) va tiep tuc duoc bang
 * `resume` — khong ai nham tuong inventory la day du.
 *
 * Nem ReaderProviderUnavailableError khi khong chunk nao doc duoc VI GEMINI
 * khong kha dung; tra ve null khi Gemini tra loi nhung khong co atom nao; nem
 * lai loi xac thuc (sai API key) vi doi agent khong cuu duoc.
 */
export async function readTextDocument(input: {
  fileName: string;
  text: string;
  resume?: ReaderCheckpoint;
  onEvent?: (event: ReaderEvent) => void;
}): Promise<ReaderResult | null> {
  const chunks = chunkDocumentText(input.text);
  if (chunks.length === 0) return null;
  const total = chunks.length;

  const warnings: string[] = [];
  const maxChunks = getReaderMaxChunks();
  const estimatedChunks = Math.ceil(input.text.trim().length / getReaderChunkChars());
  if (estimatedChunks > maxChunks) {
    warnings.push(
      `Tài liệu rất dài: chỉ ${maxChunks} phần đầu được phân tích (giới hạn AI_READER_MAX_CHUNKS). Hãy tách tài liệu hoặc tăng giới hạn để phân tích đầy đủ.`,
    );
  }

  const agents = getModelChain('document_extraction');
  const steps = chunks.map((chunk) => ({ id: `c${chunk.index}`, hash: chunkStepHash(input.fileName, chunk) }));
  const chunkById = new Map(chunks.map((chunk) => [`c${chunk.index}`, chunk]));

  // Ngan sach thoi gian cho TOAN BO ham nay — xem ReaderBudget o tren. Day la
  // phong tuyen CUOI CUNG truoc khi nen tang serverless tu tay giet function.
  const budget = new ReaderBudget(getReaderTotalBudgetMs());
  const retryOverride = { maxRetriesPerModel: getReaderMaxRetriesPerModel() };
  const auditEnabled = isReaderAuditPassEnabled();
  const auditSkippedForBudget = new Set<string>();

  // Chunk da xong san trong checkpoint (cung phep kiem hash nhu runner) — chi de
  // phat su kien `progress` chinh xac ngay tu dau.
  const completedIds = new Set(
    steps.filter((s) => input.resume?.steps[s.id]?.hash === s.hash && input.resume.steps[s.id].complete).map((s) => s.id),
  );
  input.onEvent?.({ type: 'progress', completed: completedIds.size, total });

  const job = await runResumableJob<ReaderChunkState>({
    steps,
    agents,
    resume: input.resume?.steps,
    concurrency: getReaderConcurrency(),
    demoteAfter: getAgentDemoteAfter(),
    cooldownMs: getAgentCooldownMs(),
    hasTime: () => budget.hasTimeForAnotherCall(),
    onEvent: (event) => {
      if (!input.onEvent) return;
      switch (event.type) {
        case 'checkpoint':
          input.onEvent({ type: 'checkpoint', step_id: event.stepId, record: event.record });
          if (event.record.complete && !completedIds.has(event.stepId)) {
            completedIds.add(event.stepId);
            input.onEvent({ type: 'progress', completed: completedIds.size, total });
          }
          break;
        case 'handoff':
          input.onEvent(event);
          break;
        case 'agent_demoted':
          input.onEvent({ type: 'agent_demoted', agent: event.agent });
          break;
        case 'agent_restored':
          input.onEvent({ type: 'agent_restored', agent: event.agent });
          break;
      }
    },
    execute: async (ctx) => {
      const chunk = chunkById.get(ctx.stepId)!;
      const label = `chunk ${chunk.index}/${chunk.total}`;
      const callOptions = () => ({ agent: ctx.agent, timeoutMs: budget.timeoutForNextCall(), ...retryOverride });

      // Trang thai nhan tu agent truoc / checkpoint cu: neu pha 1 da co thi KHONG lam lai.
      let state: ReaderChunkState = ctx.previous ?? {};
      let ranPhaseOne = false;

      if (!state.extracted) {
        const first = await extractAtoms(
          buildTextDocumentExtractionPrompt({
            sourceLabel: input.fileName,
            rawText: chunk.text,
            chunkIndex: chunk.index,
            chunkTotal: chunk.total,
          }),
          label,
          callOptions(),
        );
        state = { extracted: { ...first.data, ...(first.truncated ? { truncated: true } : {}) } };
        ranPhaseOne = true;
      }

      // Pha 2. Chay khi audit bat, HOAC khi pha 1 bi cat cut giua chung (truncated):
      // audit chinh la co che "tiep tuc phan con thieu" — no nhan danh sach atom da
      // co va chi tra ve phan sot, nen ban do cua agent truoc duoc BO SUNG thay vi vut.
      const needsAudit = state.audit === undefined && (auditEnabled || state.extracted?.truncated === true);
      if (!needsAudit) return { state, complete: true };

      // Chi chay audit neu con du ngan sach — bo qua co canh bao ro rang, giu pha 1.
      if (!budget.hasTimeForAnotherCall()) {
        auditSkippedForBudget.add(ctx.stepId);
        return { state, complete: false };
      }

      // Ghi checkpoint pha 1 TRUOC khi audit: neu tien trinh bi giet trong luc
      // audit, pha 1 (ton 30-50s Gemini) khong bi mat.
      if (ranPhaseOne) ctx.save(state);

      try {
        const audit = await extractAtoms(
          buildDocumentCompletenessAuditPrompt({
            sourceLabel: input.fileName,
            rawText: chunk.text,
            existingAtoms: state.extracted!.atoms.map((a) => ({ atom_id: a.atom_id, label: a.label })),
            chunkIndex: chunk.index,
            chunkTotal: chunk.total,
          }),
          `${label} audit`,
          callOptions(),
        );
        return { state: { ...state, audit: audit.data.atoms }, complete: true };
      } catch (error) {
        // Agent hong GIUA CHUNG: ban giao pha 1 cho agent ke tiep de no chi lam audit.
        throw new StepInterruptedError(state, error);
      }
    },
  });

  // Loi xac thuc (sai/thieu API key): doi agent khong cuu duoc — noi that ra, khong nuot.
  if (job.fatalError !== undefined) throw job.fatalError;

  // ── Gop ket qua THEO THU TU CHUNK, khong theo thu tu hoan thanh. ──
  let title = input.fileName;
  let summary = '';
  const firstPassBatches: DocumentAtom[][] = [];
  const auditBatches: DocumentAtom[][] = [];
  chunks.forEach((chunk) => {
    const state = job.records[`c${chunk.index}`]?.state;
    if (state?.extracted) {
      if (chunk.index === 1) {
        title = state.extracted.title?.trim() || title;
        summary = state.extracted.summary?.trim() || summary;
      }
      firstPassBatches.push(state.extracted.atoms);
    }
    if (state?.audit) auditBatches.push(state.audit);
  });
  const firstPassCount = firstPassBatches.reduce((n, b) => n + b.length, 0);
  const merged = mergeAtoms([...firstPassBatches, ...auditBatches]);

  // ── Phan loai trang thai tung chunk de bao cao trung thuc. ──
  const failedIds = chunks.map((c) => `c${c.index}`).filter((id) => job.stepStatus[id] === 'failed');
  const partialIds = chunks.map((c) => `c${c.index}`).filter((id) => job.stepStatus[id] === 'partial');
  const pendingIds = chunks.map((c) => `c${c.index}`).filter((id) => job.stepStatus[id] !== 'done');
  const processed = job.attemptedSteps.length + job.resumedSteps.length;
  const skipped = Math.max(0, total - processed);
  const indexOf = (id: string) => Number(id.slice(1));

  for (const id of failedIds) {
    warnings.push(`Không phân tích được phần ${indexOf(id)}/${total} của tài liệu.`);
  }
  for (const id of partialIds) {
    warnings.push(
      auditSkippedForBudget.has(id)
        ? `Đã bỏ qua lượt audit độ đầy đủ cho phần ${indexOf(id)}/${total} vì sắp hết ngân sách thời gian.`
        : `Phần ${indexOf(id)}/${total} đã được đọc nhưng lượt audit độ đầy đủ chưa hoàn tất.`,
    );
  }
  if (skipped > 0 && job.stopReason === 'agents_unavailable') {
    warnings.push(
      `Đã dừng sớm: tất cả model Gemini đã cấu hình (${agents.join(', ')}) đều không phản hồi nên bỏ qua ${skipped}/${total} phần còn lại thay vì chờ vô ích. Vui lòng thử lại sau ít phút — các phần đã đọc được giữ nguyên.`,
    );
    console.warn(
      `[Reader] "${input.fileName}": mọi agent bị hạ cấp sau ${processed}/${total} chunk (Gemini không khả dụng) — bỏ qua ${skipped} chunk còn lại.`,
    );
  } else if (skipped > 0 && job.stopReason === 'budget') {
    warnings.push(
      `Đã hết ngân sách thời gian sau khi xử lý ${processed}/${total} phần — còn ${skipped} phần chưa được phân tích. Tăng AI_READER_TOTAL_BUDGET_MS, hoặc tách tài liệu thành các phần nhỏ hơn và tải lên riêng để phân tích đầy đủ.`,
    );
    console.warn(
      `[Reader] "${input.fileName}": hết ngân sách thời gian sau ${processed}/${total} chunk — dừng có kiểm soát thay vì để function bị nền tảng buộc dừng giữa chừng.`,
    );
  }
  if (job.handoffs.length > 0) {
    console.info(
      `[Reader] "${input.fileName}": ${job.handoffs.length} lần chuyển agent — ` +
        job.handoffs.map((h) => `${h.step_id} ${h.from}→${h.to} (${h.reason}${h.carried_state ? ', giữ trạng thái' : ''})`).join('; '),
    );
  }

  const anyExtracted = firstPassBatches.length > 0;
  if (merged.atoms.length === 0) {
    // Moi chunk da thu deu that bai vi CHINH GEMINI (khong phai noi dung file):
    // day la loi tam thoi, phai noi ro de nguoi dung thu lai thay vi nghi file hong.
    if (failedIds.length > 0 && !anyExtracted && failedIds.every((id) => isProviderUnavailable(job.stepErrors[id]))) {
      throw new ReaderProviderUnavailableError({
        failedChunks: failedIds.length,
        totalChunks: total,
        skippedChunks: skipped,
      });
    }
    return null;
  }

  const auditContribution = merged.atoms.length - new Set(firstPassBatches.flat().map(contentKey)).size;

  return {
    title,
    summary: summary || `Tài liệu "${title}" — ${merged.atoms.length} yêu cầu có thể kiểm thử.`,
    atoms: merged.atoms,
    stats: {
      source_chars: input.text.trim().length,
      // chunks DA XU LY (thu trong lan nay + khoi phuc tu checkpoint), khong phai
      // tong so chunk du kien — canh bao ben tren neu ro tong so con thieu.
      chunks: processed,
      atoms_first_pass: firstPassCount,
      atoms_from_audit: Math.max(0, auditContribution),
      duplicates_removed: merged.duplicates_removed,
      failed_chunks: failedIds.length,
      resumed_chunks: job.resumedSteps.length,
      agent_handoffs: job.handoffs.length,
      pending_chunks: pendingIds.length,
    },
    warnings,
    job: {
      status: job.status,
      stop_reason: job.stopReason,
      total_steps: total,
      completed_steps: total - pendingIds.length,
      resumed_steps: job.resumedSteps.length,
      pending_step_ids: pendingIds,
      handoffs: job.handoffs,
      agents,
      checkpoint: { v: 1, steps: job.records },
    },
  };
}
