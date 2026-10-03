// ============================================================================
// File: src/services/ai/execution-budget.ts
// ONE shared notion of "how much time do I have left" for every AI workflow.
// ----------------------------------------------------------------------------
// Before this, only the document reader tracked a deadline (AI_READER_TOTAL_
// BUDGET_MS, local to reader.ts). The engine, Generate, coverage repair, Review
// and Enhance had none — so a call could retry across 4 models x 3 attempts x
// 60-100s inside a route whose maxDuration is 120-300s. Vercel then killed the
// function mid-retry and every completed batch was lost.
//
// A budget is created ONCE per request (route) and passed DOWN:
//
//     route budget  ->  workflow stage (generate batch / repair round)
//                   ->  engine call  ->  each attempt (timeout = min(own, remaining))
//
// Everything downstream asks the budget before starting work, so the system
// stops EARLY and returns partial progress instead of being killed.
// Pure + clock-injectable: no env reads except the explicit helpers at the end.
// ============================================================================

export type Clock = () => number;

export type ExecutionBudgetOptions = {
  /** Time held back for persistence + building the HTTP response. */
  reserveMs?: number;
  now?: Clock;
  label?: string;
  /** When set, this budget can never outlive its parent. */
  parent?: ExecutionBudget;
};

export class ExecutionBudget {
  readonly label: string;
  private readonly startedAt: number;
  private readonly now: Clock;
  private readonly reserveMs: number;
  private readonly parent?: ExecutionBudget;

  constructor(readonly totalMs: number, options: ExecutionBudgetOptions = {}) {
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
    this.reserveMs = Math.max(0, options.reserveMs ?? 0);
    this.parent = options.parent;
    this.label = options.label ?? 'budget';
  }

  elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  /** Raw time left, including the reserve (and never more than the parent has). */
  remainingMs(): number {
    const own = Math.max(0, this.totalMs - this.elapsedMs());
    return this.parent ? Math.min(own, this.parent.remainingMs()) : own;
  }

  /** Time left that WORK may use: remaining minus the reserve for persistence/response. */
  usableMs(): number {
    const own = Math.max(0, this.remainingMs() - this.reserveMs);
    return this.parent ? Math.min(own, this.parent.usableMs()) : own;
  }

  canAfford(ms: number): boolean {
    return this.usableMs() >= ms;
  }

  isExhausted(): boolean {
    return this.usableMs() <= 0;
  }

  /** A sub-budget for one stage. It can never outlive this budget. */
  child(maxMs: number, label?: string): ExecutionBudget {
    return new ExecutionBudget(maxMs, { now: this.now, label: label ?? `${this.label}/child`, parent: this });
  }
}

/** Safety margin kept free at the end of every route. */
export function getBudgetReserveMs(): number {
  const raw = Number(process.env.AI_BUDGET_RESERVE_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 15_000;
  return Math.min(60_000, Math.max(1_000, Math.floor(raw)));
}

/**
 * Budget for a route with `export const maxDuration = N` (seconds). The reserve
 * is scaled down for short routes so a 60s route is not left with no work time.
 */
export function createRouteBudget(maxDurationSeconds: number, label: string, now?: Clock): ExecutionBudget {
  const totalMs = maxDurationSeconds * 1000;
  const reserveMs = Math.min(getBudgetReserveMs(), Math.floor(totalMs * 0.15));
  return new ExecutionBudget(totalMs, { reserveMs, label, now });
}
