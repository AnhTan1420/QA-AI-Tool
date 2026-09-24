// ============================================================================
// File: src/lib/documents/resumable-parse.ts
// PHIA CLIENT cua Agent Fallback & Job Resumption.
// ----------------------------------------------------------------------------
// Server (services/ai/resumable-job.ts + app/api/ai/documents/parse) lo phan
// FAILOVER giua cac agent va phat checkpoint tung chunk. Nhung mot so su co
// khong the tu sua o phia server: function bi nen tang giet (Vercel "Task timed
// out"), mat ket noi, het ngan sach thoi gian, hoac ca cum model cung sap. Luc
// do chi co 1 thu con song: cac checkpoint client DA NHAN.
//
// Ham nay lam cho viec do TRONG SUOT voi nguoi dung:
//   1. POST voi `Accept: application/x-ndjson` va doc stream, gom checkpoint.
//   2. Neu ket thuc that su (result completed) -> tra ve.
//   3. Neu bi ngat / job dang do / loi tam thoi -> cho (backoff) roi POST LAI
//      kem `resume` = checkpoint da gom: server chi lam phan con thieu.
//   4. Lap toi da `maxRounds` lan. Het luot ma van dang do -> tra ve KET QUA MOT
//      PHAN (kem canh bao ro rang) thay vi vut het; khong co gi thi moi nem loi.
// ============================================================================

import { ApiError } from '@/lib/api/client';
import type { ParsedDocument, ReaderCheckpoint, ReaderStepRecord } from '@/models/validators/document';

export type ResumeProgress = {
  /** 'reading' = lan doc dau; 'resuming' = dang tu dong tiep tuc sau khi bi ngat/dang do. */
  kind: 'reading' | 'resuming';
  round: number;
  maxRounds: number;
  /** So chunk da xong / tong so chunk (0/0 khi chua biet). */
  completed: number;
  total: number;
  /** Co khi server vua chuyen tu model chinh sang model du phong. */
  handoff?: { from: string; to: string };
};

type JobSummary = {
  status: 'completed' | 'partial';
  stop_reason?: string;
  total_steps?: number;
  completed_steps?: number;
  pending_step_ids?: string[];
  checkpoint?: ReaderCheckpoint;
};

type RoundOutcome =
  | { kind: 'result'; data: ParsedDocument; job: JobSummary }
  | { kind: 'error'; status: number; message: string; retryable: boolean }
  | { kind: 'interrupted' };

export type ResumableParseOptions = {
  fetchImpl?: typeof fetch;
  url?: string;
  /** Tong so lan goi (1 lan dau + cac lan resume). Mac dinh 4. */
  maxRounds?: number;
  sleep?: (ms: number) => Promise<void>;
  backoffMs?: (round: number, reason: 'budget' | 'unavailable') => number;
  onProgress?: (progress: ResumeProgress) => void;
  /** Thong diep khi HTTP loi ma body khong phai JSON cua app (vd trang loi cua nen tang). */
  requestFailedMessage: string;
  /** Them canh bao vao ket qua khi het luot resume ma van con phan chua doc. */
  giveUpWarning?: (rounds: number, pendingChunks: number) => string;
  signal?: AbortSignal;
};

const DEFAULT_URL = '/api/ai/documents/parse';
const DEFAULT_MAX_ROUNDS = 4;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Server dung do chu dong vi het ngan sach -> tiep tuc ngay; Gemini sap -> cho lau hon. */
function defaultBackoff(round: number, reason: 'budget' | 'unavailable'): number {
  if (reason === 'budget') return 500;
  return Math.min(3_000 * 2 ** (round - 1), 20_000);
}

function countComplete(checkpoint: ReaderCheckpoint): number {
  return Object.values(checkpoint.steps).filter((r) => r.complete).length;
}

function isAbort(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'AbortError';
}

/**
 * Doc 1 tai lieu qua /api/ai/documents/parse va TU DONG tiep tuc tu checkpoint neu
 * bi ngat. Nem ApiError khi khong the tiep tuc (loi khong retry duoc, hoac het luot
 * ma chua doc duoc gi).
 */
export async function parseDocumentResumable(
  payload: Record<string, unknown>,
  options: ResumableParseOptions,
): Promise<ParsedDocument> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const url = options.url ?? DEFAULT_URL;
  const maxRounds = Math.max(1, options.maxRounds ?? DEFAULT_MAX_ROUNDS);
  const sleep = options.sleep ?? defaultSleep;
  const backoff = options.backoffMs ?? defaultBackoff;

  let checkpoint: ReaderCheckpoint = (payload.resume as ReaderCheckpoint | undefined) ?? { v: 1, steps: {} };
  let total = 0;
  let best: { data: ParsedDocument; job: JobSummary } | null = null;
  let lastMessage = options.requestFailedMessage;

  async function runRound(round: number): Promise<RoundOutcome> {
    const hasCheckpoint = Object.keys(checkpoint.steps).length > 0;
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson, application/json;q=0.9' },
        body: JSON.stringify({ ...payload, resume: hasCheckpoint ? checkpoint : undefined }),
        signal: options.signal,
      });
    } catch (error) {
      if (isAbort(error)) throw error; // nguoi dung chu dong huy — khong phai su co
      return { kind: 'interrupted' };
    }

    // ── Khong phai stream: envelope JSON cua app (loi validate, client cu...) hoac trang loi nen tang. ──
    if (!(response.headers.get('content-type') ?? '').includes('application/x-ndjson')) {
      let body: { success?: boolean; data?: ParsedDocument; job?: JobSummary; error?: string; retryable?: boolean };
      try {
        body = await response.json();
      } catch {
        // 502/503/504 (function bi giet, timeout nen tang) tra HTML/plaintext: coi la bi NGAT va resume.
        // 4xx (vd 413 qua lon) khong the tu khoi phuc.
        const transient = response.status >= 500;
        return transient
          ? { kind: 'interrupted' }
          : { kind: 'error', status: response.status, message: options.requestFailedMessage, retryable: false };
      }
      if (response.ok && body.success && body.data) {
        return { kind: 'result', data: body.data, job: body.job ?? { status: 'completed' } };
      }
      return {
        kind: 'error',
        status: response.status,
        message: body.error ?? options.requestFailedMessage,
        retryable: body.retryable ?? response.status >= 500,
      };
    }

    // ── Stream NDJSON: gom checkpoint NGAY khi toi, de ke ca khi stream dut giua chung van con. ──
    if (!response.body) return { kind: 'interrupted' };
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let terminal: RoundOutcome | null = null;
    let pendingHandoff: { from: string; to: string } | undefined;

    const handleLine = (line: string) => {
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
      } catch {
        return; // dong hong (bi cat giua chung) — bo qua
      }
      switch (event.type) {
        case 'progress':
          total = Number(event.total) || total;
          options.onProgress?.({
            kind: round === 1 ? 'reading' : 'resuming',
            round,
            maxRounds,
            completed: Number(event.completed) || 0,
            total,
            handoff: pendingHandoff,
          });
          pendingHandoff = undefined;
          break;
        case 'checkpoint': {
          const id = String(event.step_id);
          const record = event.record as ReaderStepRecord | undefined;
          if (record && typeof record.hash === 'string') {
            // Khong bao gio ha 1 buoc DA XONG xuong dang do.
            if (!(checkpoint.steps[id]?.complete && !record.complete)) {
              checkpoint = { v: 1, steps: { ...checkpoint.steps, [id]: record } };
            }
          }
          break;
        }
        case 'handoff':
          pendingHandoff = { from: String(event.from), to: String(event.to) };
          break;
        case 'result':
          terminal = { kind: 'result', data: event.data as ParsedDocument, job: (event.job as JobSummary) ?? { status: 'completed' } };
          break;
        case 'error':
          terminal = {
            kind: 'error',
            status: Number(event.status) || 500,
            message: String(event.error ?? options.requestFailedMessage),
            retryable: Boolean(event.retryable),
          };
          break;
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline: number;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) handleLine(line);
        }
      }
      if (buffer.trim()) handleLine(buffer.trim());
    } catch (error) {
      if (isAbort(error)) throw error;
      // Mat ket noi giua stream: giu nhung checkpoint da nhan, resume o vong sau.
      return terminal ?? { kind: 'interrupted' };
    }
    // Stream dong ma khong co result/error = bi ngat (function bi giet, dut mang).
    return terminal ?? { kind: 'interrupted' };
  }

  for (let round = 1; round <= maxRounds; round++) {
    options.onProgress?.({
      kind: round === 1 ? 'reading' : 'resuming',
      round,
      maxRounds,
      completed: countComplete(checkpoint),
      total,
    });

    const outcome = await runRound(round);

    if (outcome.kind === 'result') {
      if (outcome.job.status === 'completed') return outcome.data;
      // Dang do: giu ket qua tot nhat + checkpoint cua server (superset cua nhung gi da nhan).
      best = { data: outcome.data, job: outcome.job };
      if (outcome.job.checkpoint) checkpoint = outcome.job.checkpoint;
      if (round < maxRounds) await sleep(backoff(round, outcome.job.stop_reason === 'budget' ? 'budget' : 'unavailable'));
      continue;
    }

    if (outcome.kind === 'error') {
      lastMessage = outcome.message;
      if (!outcome.retryable) break;
    }
    // 'interrupted' hoac loi retryable: cho roi resume tu checkpoint da gom.
    if (round < maxRounds) await sleep(backoff(round, 'unavailable'));
  }

  if (best) {
    const pending = best.job.pending_step_ids?.length ?? 0;
    const warning = options.giveUpWarning?.(maxRounds, pending);
    return warning
      ? { ...best.data, reader_warnings: [...(best.data.reader_warnings ?? []), warning] }
      : best.data;
  }
  throw new ApiError(lastMessage);
}
