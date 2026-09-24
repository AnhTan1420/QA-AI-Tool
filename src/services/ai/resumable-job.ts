// ============================================================================
// File: src/services/ai/resumable-job.ts
// AGENT FALLBACK & JOB RESUMPTION — loi dieu phoi cho moi workflow nhieu buoc.
// ----------------------------------------------------------------------------
// Van de: engine Gemini (gemini.ts) da co fallback THEO TUNG LAN GOI — nhung
// moi lan goi la vo trang thai. He qua:
//   1. Khi model chinh 503, MOI buoc lai bat dau lai tu model chinh, tra lai
//      dung chi phi that bai do (~63s/chunk trong su co 23/9). Khong ai "nho"
//      model chinh dang om.
//   2. Model du phong luon lam lai TU DAU. Buoc da xong mot nua (vd da trich
//      atom, chi con audit) khong duoc ban giao trang thai.
//   3. Neu ca tien trinh bi giet giua chung (Vercel "Task timed out", crash,
//      deploy), MOI thu da lam bi mat — khong co gi de tiep tuc.
//
// Mo hinh nay tach 3 khai niem:
//   • STEP  : 1 don vi cong viec doc lap (vd 1 chunk tai lieu), co `hash` cua
//             dau vao de checkpoint cu khong bao gio bi dung nham cho dau vao khac.
//   • AGENT : 1 model trong chuoi uu tien (primary → secondary → ...).
//   • STATE : ket qua (co the DANG DO) cua 1 step — la thu duoc ban giao cho
//             agent ke tiep va duoc checkpoint ra ngoai de resume.
//
// Runner KHONG biet gi ve Gemini hay tai lieu: no chi (a) chon agent theo suc
// khoe, (b) chuyen agent khi that bai kem theo trang thai dang do, (c) phat su
// kien checkpoint sau MOI buoc de nguoi goi luu/stream ra ngoai, (d) nhan
// checkpoint cu de bo qua nhung buoc da xong.
// ============================================================================

import { classifyGeminiError, GeminiProviderError, isTimeoutError } from './errors';

export type StepStatus = 'done' | 'partial' | 'failed' | 'pending';

/** 1 buoc cong viec: `id` on dinh, `hash` la dau van tay cua DAU VAO cua buoc. */
export type JobStep = { id: string; hash: string };

/** Ban ghi checkpoint cua 1 buoc. `complete=false` nghia la con dang do (state co the co). */
export type StepRecord<S> = {
  hash: string;
  complete: boolean;
  /** Agent (model) da tao ra `state` nay. */
  agent?: string;
  state?: S;
};

/** Checkpoint = ban ghi cua cac buoc, theo step id. */
export type JobCheckpoint<S> = Record<string, StepRecord<S>>;

export type Handoff = {
  step_id: string;
  from: string;
  to: string;
  /** Vd 'transient/503', 'timeout', 'crash' — lay tu loi that bai cua agent `from`. */
  reason: string;
  /** true neu agent ke tiep nhan duoc trang thai dang do cua buoc (khong lam lai tu dau). */
  carried_state: boolean;
};

export type StopReason = 'complete' | 'budget' | 'agents_unavailable' | 'step_failures';

export type JobEvent<S> =
  | { type: 'checkpoint'; stepId: string; record: StepRecord<S> }
  | ({ type: 'handoff' } & Handoff)
  | { type: 'agent_demoted'; agent: string; until: number }
  | { type: 'agent_restored'; agent: string };

/**
 * Nem tu `execute` khi 1 buoc da lam duoc MOT PHAN roi agent gap su co (vd da
 * trich xong atom, dang audit thi model 503). `partial` se duoc ban giao cho
 * agent ke tiep qua `ctx.previous` thay vi bi vut di.
 */
export class StepInterruptedError<S> extends Error {
  readonly name = 'StepInterruptedError';
  constructor(
    readonly partial: S,
    readonly cause?: unknown,
  ) {
    super('Step interrupted after partial progress');
  }
}

export type StepContext<S> = {
  stepId: string;
  /** Agent dang duoc giao viec. */
  agent: string;
  /** Trang thai dang do tu agent truoc / tu checkpoint cu (neu co). */
  previous?: S;
  /** Lan thu thu may cho buoc nay TRONG lan chay nay (1 = agent dau tien). */
  attempt: number;
  /** Ghi 1 checkpoint dang do (vd xong pha 1) ngay lap tuc, truoc khi buoc xong han. */
  save: (partial: S) => void;
};

/** `complete:false` = dung CO CHU DICH (vd het ngan sach) — giu state, KHONG chuyen agent. */
export type StepOutcome<S> = { state: S; complete: boolean };

export type RunJobOptions<S> = {
  steps: JobStep[];
  /** Thu tu uu tien: agents[0] la primary, agents[1] la secondary... */
  agents: string[];
  execute: (ctx: StepContext<S>) => Promise<StepOutcome<S>>;
  /** Checkpoint cu. Ban ghi nao co hash khac dau vao hien tai bi BO (khong bao gio dung nham). */
  resume?: JobCheckpoint<S>;
  concurrency?: number;
  /** Con du thoi gian de bat dau them 1 buoc / 1 lan thu agent nua khong. Mac dinh: luon co. */
  hasTime?: () => boolean;
  /** So lan that bai LIEN TIEP truoc khi 1 agent bi ha cap (bo qua) trong phan con lai cua lan chay. Mac dinh 2. */
  demoteAfter?: number;
  /** Sau bao lau agent bi ha cap duoc thu lai (failback). Mac dinh 60s. */
  cooldownMs?: number;
  now?: () => number;
  /** Loi khong the cuu bang cach doi agent (vd sai API key) — dung ca job. */
  isFatal?: (error: unknown) => boolean;
  onEvent?: (event: JobEvent<S>) => void;
};

export type JobRunResult<S> = {
  status: 'completed' | 'partial';
  stopReason: StopReason;
  records: JobCheckpoint<S>;
  stepStatus: Record<string, StepStatus>;
  /** Cac buoc duoc khoi phuc nguyen ven tu checkpoint (khong chay lai). */
  resumedSteps: string[];
  /** Cac buoc thuc su duoc thu trong lan chay nay. */
  attemptedSteps: string[];
  handoffs: Handoff[];
  /** Loi CUOI CUNG cua tung buoc that bai (de nguoi goi phan loai nguyen nhan). */
  stepErrors: Record<string, unknown>;
  fatalError?: unknown;
};

const DEFAULT_DEMOTE_AFTER = 2;
const DEFAULT_COOLDOWN_MS = 60_000;

/** Loi ma doi agent khong giup gi (cung 1 API key) — dung ca job thay vi thu het chuoi. */
export function isAuthFailure(error: unknown): boolean {
  if (error instanceof GeminiProviderError) return error.meta.lastKind === 'auth';
  return classifyGeminiError(error) === 'auth';
}

/** Nhan ngan gon, an toan de log/hien thi ly do 1 agent that bai. */
export function describeAgentFailure(error: unknown): string {
  const cause = error instanceof StepInterruptedError ? error.cause : error;
  if (isTimeoutError(cause)) return 'timeout';
  if (cause instanceof GeminiProviderError) {
    const { lastKind, lastStatus } = cause.meta;
    if (lastStatus) return `${lastKind}/${lastStatus}`;
    // Chuoi model 1 phan tu bi timeout: GeminiProviderError boc AbortError.
    return isTimeoutError(cause.meta.cause) ? 'timeout' : lastKind;
  }
  return 'crash';
}

type AgentHealth = { consecutiveFailures: number; disabledUntil: number };

export async function runResumableJob<S>(options: RunJobOptions<S>): Promise<JobRunResult<S>> {
  const { steps, agents, execute } = options;
  const demoteAfter = Math.max(1, options.demoteAfter ?? DEFAULT_DEMOTE_AFTER);
  const cooldownMs = options.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const now = options.now ?? Date.now;
  const hasTime = options.hasTime ?? (() => true);
  const isFatal = options.isFatal ?? isAuthFailure;
  const emit = (event: JobEvent<S>) => {
    // Loi cua consumer (vd stream da dong) khong bao gio duoc lam hong job.
    try {
      options.onEvent?.(event);
    } catch {
      /* ignore */
    }
  };

  const records: JobCheckpoint<S> = {};
  const resumedSteps: string[] = [];
  for (const step of steps) {
    const prior = options.resume?.[step.id];
    // hash khac = dau vao (noi dung / cau hinh chunk / phien ban prompt) da doi:
    // checkpoint nay thuoc ve mot cong viec khac, dung no la tra loi sai cau hoi.
    if (prior && prior.hash === step.hash && (prior.complete || prior.state !== undefined)) {
      records[step.id] = { ...prior };
      if (prior.complete) resumedSteps.push(step.id);
    }
  }

  const pending = steps.filter((s) => !records[s.id]?.complete);
  const stepStatus: Record<string, StepStatus> = {};
  for (const step of steps) {
    const rec = records[step.id];
    stepStatus[step.id] = rec?.complete ? 'done' : rec?.state !== undefined ? 'partial' : 'pending';
  }

  const health: Record<string, AgentHealth> = {};
  for (const agent of agents) health[agent] = { consecutiveFailures: 0, disabledUntil: 0 };

  const handoffs: Handoff[] = [];
  const attemptedSteps: string[] = [];
  const stepErrors: Record<string, unknown> = {};
  let fatalError: unknown;
  let budgetHit = false;
  let agentsDown = false;

  function isDisabled(agent: string): boolean {
    const h = health[agent];
    if (h.disabledUntil === 0) return false;
    if (h.disabledUntil > now()) return true;
    // Het cooldown: cho thu lai (failback). Chi can 1 that bai nua la bi ha cap ngay.
    h.disabledUntil = 0;
    h.consecutiveFailures = demoteAfter - 1;
    emit({ type: 'agent_restored', agent });
    return false;
  }

  function pickAgent(tried: Set<string>): string | undefined {
    return agents.find((agent) => !tried.has(agent) && !isDisabled(agent));
  }

  function allAgentsDisabled(): boolean {
    return agents.every((agent) => isDisabled(agent));
  }

  function recordAgentFailure(agent: string): void {
    const h = health[agent];
    h.consecutiveFailures++;
    if (h.consecutiveFailures >= demoteAfter && h.disabledUntil === 0) {
      h.disabledUntil = now() + cooldownMs;
      emit({ type: 'agent_demoted', agent, until: h.disabledUntil });
    }
  }

  function store(stepId: string, hash: string, agent: string, state: S | undefined, complete: boolean): void {
    const record: StepRecord<S> = { hash, complete, agent, ...(state !== undefined ? { state } : {}) };
    records[stepId] = record;
    emit({ type: 'checkpoint', stepId, record });
  }

  async function runStep(step: JobStep): Promise<void> {
    const tried = new Set<string>();
    let attemptedAny = false;

    while (!fatalError) {
      const agent = pickAgent(tried);
      if (!agent) break;
      if (!hasTime()) {
        budgetHit = true;
        break;
      }

      attemptedAny = true;
      if (!attemptedSteps.includes(step.id)) attemptedSteps.push(step.id);

      try {
        const outcome = await execute({
          stepId: step.id,
          agent,
          previous: records[step.id]?.state,
          attempt: tried.size + 1,
          save: (partial) => store(step.id, step.hash, agent, partial, false),
        });
        store(step.id, step.hash, agent, outcome.state, outcome.complete);
        health[agent].consecutiveFailures = 0;
        stepStatus[step.id] = outcome.complete ? 'done' : 'partial';
        delete stepErrors[step.id];
        return;
      } catch (error) {
        if (isFatal(error)) {
          fatalError = error;
          return;
        }
        stepErrors[step.id] = error instanceof StepInterruptedError ? (error.cause ?? error) : error;
        tried.add(agent);
        // Agent that bai SAU KHI da lam duoc 1 phan: giu phan do de ban giao.
        if (error instanceof StepInterruptedError) {
          store(step.id, step.hash, agent, error.partial, false);
        }
        recordAgentFailure(agent);

        const next = pickAgent(tried);
        if (next) {
          const handoff: Handoff = {
            step_id: step.id,
            from: agent,
            to: next,
            reason: describeAgentFailure(error),
            carried_state: records[step.id]?.state !== undefined,
          };
          handoffs.push(handoff);
          emit({ type: 'handoff', ...handoff });
        }
      }
    }

    const rec = records[step.id];
    stepStatus[step.id] = rec?.state !== undefined ? 'partial' : attemptedAny ? 'failed' : stepStatus[step.id];
  }

  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      if (fatalError) return;
      if (cursor >= pending.length) return;
      if (allAgentsDisabled()) {
        agentsDown = true;
        return;
      }
      if (!hasTime()) {
        budgetHit = true;
        return;
      }
      await runStep(pending[cursor++]);
    }
  }

  const workerCount = Math.max(1, Math.min(options.concurrency ?? 1, pending.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  const allDone = steps.every((s) => stepStatus[s.id] === 'done');
  const stopReason: StopReason = allDone
    ? 'complete'
    : budgetHit
      ? 'budget'
      : agentsDown || allAgentsDisabled()
        ? 'agents_unavailable'
        : 'step_failures';

  return {
    status: allDone ? 'completed' : 'partial',
    stopReason,
    records,
    stepStatus,
    resumedSteps,
    attemptedSteps,
    handoffs,
    stepErrors,
    ...(fatalError !== undefined ? { fatalError } : {}),
  };
}
