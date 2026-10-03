// ============================================================================
// File: src/services/ai/ai-telemetry.ts
// Structured, BOUNDED observability for every AI attempt.
// ----------------------------------------------------------------------------
// One JSON line per attempt and one per task. Carries sizes and outcomes —
// NEVER prompt text, document content, model output, API keys or headers — so
// a future "why did it stop?" has a measurable answer without leaking data or
// producing huge logs.
// ============================================================================

import type { FailureCode } from './errors';

export type AiAttemptEvent = {
  event: 'ai_attempt';
  task: string;
  label?: string;
  model: string;
  /** 1-based, counted across the whole call (all models). */
  attempt: number;
  outcome: 'ok' | 'failed';
  failure?: FailureCode;
  /** What the retry policy decided next, e.g. retry_same | next_model | stop. */
  action?: string;
  latency_ms: number;
  timeout_ms: number;
  input_tokens_est: number;
  output_tokens_est: number;
  max_output_tokens: number;
  schema_degraded: boolean;
  thinking?: string;
  truncated: boolean;
  /** Usable budget left when the attempt started; null when no budget was supplied. */
  remaining_budget_ms: number | null;
  /** Caller-supplied workload context (batch size, repair round...). Numbers/short strings only. */
  ctx?: Record<string, number | string>;
};

export type AiTaskSummaryEvent = {
  event: 'ai_task';
  task: string;
  label?: string;
  status: 'ok' | 'failed' | 'truncated';
  failure?: FailureCode;
  model?: string;
  attempts: number;
  models_attempted: number;
  elapsed_ms: number;
  input_tokens_est: number;
  output_tokens_est: number;
  remaining_budget_ms: number | null;
  ctx?: Record<string, number | string>;
};

export type AiEvent = AiAttemptEvent | AiTaskSummaryEvent;

/** ~3 chars/token: deliberately pessimistic (Vietnamese + JSON tokenise worse than English prose). */
export const CHARS_PER_TOKEN = 3;

export function estimateTokens(chars: number): number {
  return Math.ceil(Math.max(0, chars) / CHARS_PER_TOKEN);
}

let sink: ((event: AiEvent) => void) | null = null;

/** TESTS ONLY (also usable to forward events to a metrics backend). `null` restores console logging. */
export function setAiTelemetrySink(next: ((event: AiEvent) => void) | null): void {
  sink = next;
}

function sanitizeCtx(ctx: AiAttemptEvent['ctx']): AiAttemptEvent['ctx'] {
  if (!ctx) return undefined;
  const out: Record<string, number | string> = {};
  for (const [key, value] of Object.entries(ctx).slice(0, 8)) {
    out[key.slice(0, 24)] = typeof value === 'number' ? value : String(value).slice(0, 40);
  }
  return out;
}

export function emitAiEvent(event: AiEvent): void {
  const safe = { ...event, ctx: sanitizeCtx(event.ctx) } as AiEvent;
  if (sink) {
    sink(safe);
    return;
  }
  const level = safe.event === 'ai_attempt' && safe.outcome === 'failed' ? 'warn' : 'info';
  console[level](`[ai] ${JSON.stringify(safe)}`);
}
