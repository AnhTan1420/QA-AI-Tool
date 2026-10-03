// ============================================================================
// File: src/services/ai/retry-policy.ts
// RETRY OWNERSHIP — the single place that decides what happens after a failure.
// ----------------------------------------------------------------------------
// WHO RETRIES WHAT (nobody else may retry the same request):
//
//   engine (gemini.ts)      owns retry / backoff / model fallback / schema +
//                           thinking degradation for ONE request. It asks
//                           decideNext() below. It is the ONLY retry layer.
//   workflows (generate,    never re-send an identical failed request. When
//   repair, enhance...)     the engine reports a failure that retrying cannot
//                           fix (OUTPUT_TRUNCATED, REQUEST_TOO_LARGE, TIMEOUT)
//                           they SPLIT the workload and send smaller requests.
//   client (hooks)          never auto-retries a failed request. It may only
//                           CONTINUE a partial result (resume), which sends
//                           new, smaller work — not the same request again.
//
// Each FailureCode has exactly one handling rule:
//
//   AUTH_ERROR               stop        (another model uses the same key)
//   REQUEST_TOO_LARGE        stop        (deterministic; caller must split)
//   OUTPUT_TRUNCATED         salvage or stop (identical retry truncates again)
//   SERVER_BUDGET_EXHAUSTED  stop        (preserve partial progress)
//   SCHEMA_ERROR             degrade schema once, then next model
//   MODEL_UNAVAILABLE        next model
//   RATE_LIMIT               <=1 short wait on the same model, then next model
//   TIMEOUT                  next model (same-model retry only if opted in)
//   TRANSIENT_PROVIDER_ERROR retry same model with backoff, then next model
//   INVALID_JSON / VALIDATION_ERROR  ONE resample, then next model
//   UNKNOWN                  one other model to confirm, then stop
//
// Pure function: no clock, no env, no I/O — fully unit-testable.
// ============================================================================

import {
  GeminiBadResponseError,
  GeminiBudgetExhaustedError,
  GeminiTimeoutError,
  GeminiTruncatedResponseError,
  classifyGeminiError,
  errorText,
  extractStatus,
  isTimeoutError,
  type FailureCode,
} from './errors';

/** Phrases that mean "the INPUT itself is over the model's limit" (not a config error). */
const TOO_LARGE_KEYWORDS = [
  'input token count',
  'exceeds the maximum number of tokens',
  'request payload size exceeds',
  'prompt is too long',
  'input is too long',
  'context length',
  'context window',
  'request entity too large',
  'payload too large',
];

export function classifyFailure(error: unknown): FailureCode {
  if (error instanceof GeminiBudgetExhaustedError) return 'SERVER_BUDGET_EXHAUSTED';
  if (error instanceof GeminiTruncatedResponseError) return 'OUTPUT_TRUNCATED';
  if (error instanceof GeminiBadResponseError) {
    // validateAIJson attaches the Zod issue list as `detail`; empty/unparseable output has none.
    return Array.isArray(error.detail) ? 'VALIDATION_ERROR' : 'INVALID_JSON';
  }
  if (error instanceof GeminiTimeoutError || isTimeoutError(error)) return 'TIMEOUT';

  const status = extractStatus(error);
  const text = errorText(error);

  if (status === 413) return 'REQUEST_TOO_LARGE';
  if ((status === 400 || status === undefined) && TOO_LARGE_KEYWORDS.some((k) => text.includes(k))) {
    return 'REQUEST_TOO_LARGE';
  }

  switch (classifyGeminiError(error)) {
    case 'auth':
      return 'AUTH_ERROR';
    case 'model_unavailable':
      return 'MODEL_UNAVAILABLE';
    case 'schema_incompatible':
      return 'SCHEMA_ERROR';
    case 'bad_response':
      return 'INVALID_JSON';
    case 'transient':
      return status === 429 || text.includes('rate limit') || text.includes('too many requests') || text.includes('resource_exhausted') || text.includes('quota')
        ? 'RATE_LIMIT'
        : 'TRANSIENT_PROVIDER_ERROR';
    default:
      return 'UNKNOWN';
  }
}

/**
 * Server-suggested wait for a 429 ("Please retry in 12.5s", retryDelay: "12s").
 * Returns undefined when the provider gave no usable hint.
 */
export function extractRetryAfterMs(error: unknown): number | undefined {
  const text = errorText(error);
  const match = text.match(/retry(?:\s+in|delay"?\s*[:=]?\s*"?)\s*([\d.]+)\s*(ms|s)\b/);
  if (!match) return undefined;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.round(match[2] === 'ms' ? value : value * 1000);
}

/**
 * Failures where sending SMALLER work can succeed although replaying the same
 * request cannot (output too long, input too large, too slow, or garbled because
 * it was too long). WORKFLOWS (generate, repair) use this to decide to SPLIT;
 * the engine never does — it only retries/falls back on the identical request.
 */
const SPLITTABLE_FAILURES: ReadonlySet<FailureCode> = new Set<FailureCode>([
  'OUTPUT_TRUNCATED',
  'REQUEST_TOO_LARGE',
  'TIMEOUT',
  'INVALID_JSON',
  'VALIDATION_ERROR',
]);

export function isSplittableFailure(failure: FailureCode | undefined): boolean {
  return failure !== undefined && SPLITTABLE_FAILURES.has(failure);
}

/**
 * A unit of work may be split ONCE. A half that fails again means the provider
 * (not the size) is the problem, so the workflow stops and returns progress —
 * otherwise a persistent failure would fan out 1+2+4+8... requests, each walking
 * the whole model chain: a retry storm created by the very mechanism meant to
 * avoid one.
 */
export const MAX_SPLIT_DEPTH = 1;

export type RetryAction =
  | { type: 'retry_same'; waitMs: number }
  | { type: 'next_model' }
  | { type: 'degrade_schema' }
  | { type: 'degrade_thinking' }
  | { type: 'return_salvaged' }
  | { type: 'stop'; reason: FailureCode };

export type PolicyState = {
  failure: FailureCode;
  /** Retries already spent on the CURRENT model, by family. */
  used: { transient: number; badResponse: number; rateLimit: number };
  maxRetries: number;
  /** Cap on resamples after INVALID_JSON/VALIDATION_ERROR (default 1). */
  maxBadResponseRetries: number;
  useSchema: boolean;
  allowSchemaDegradation: boolean;
  /** The API rejected thinkingConfig and we are still sending it. */
  thinkingRejected: boolean;
  retryOnTimeout: boolean;
  /** A validated partial result from a truncated response is available. */
  hasSalvage: boolean;
  hasNextModel: boolean;
  /** Models hopped to after an UNKNOWN failure so far. */
  unknownHops: number;
  /** Usable budget left (ms); null = no budget supplied. */
  remainingMs: number | null;
  /** Cheapest useful attempt (ms). Below this, starting another one is waste. */
  minAttemptMs: number;
  /** Computed backoff for the next retry (ms). */
  backoffMs: number;
  retryAfterMs?: number;
  /** Longest server-suggested 429 wait we are willing to honour. */
  maxRateLimitWaitMs?: number;
};

export function decideNext(state: PolicyState): RetryAction {
  const affordable = (ms: number): boolean => state.remainingMs === null || state.remainingMs >= ms;
  // An attempt can only start after any wait, and still needs minAttemptMs.
  const canStartAfter = (waitMs: number): boolean => affordable(waitMs + state.minAttemptMs);
  const stop = (reason: FailureCode): RetryAction => ({ type: 'stop', reason });
  const noBudget = (): RetryAction => (state.hasSalvage ? { type: 'return_salvaged' } : stop('SERVER_BUDGET_EXHAUSTED'));

  const moveOn = (): RetryAction => {
    if (!state.hasNextModel) return stop(state.failure);
    return canStartAfter(0) ? { type: 'next_model' } : noBudget();
  };
  const retry = (waitMs: number): RetryAction =>
    canStartAfter(waitMs) ? { type: 'retry_same', waitMs } : state.hasNextModel && canStartAfter(0) ? { type: 'next_model' } : noBudget();

  switch (state.failure) {
    case 'AUTH_ERROR':
    case 'REQUEST_TOO_LARGE':
    case 'SERVER_BUDGET_EXHAUSTED':
    case 'NO_PROGRESS':
      return stop(state.failure);

    case 'OUTPUT_TRUNCATED':
      // The same prompt with the same output cap truncates again — never replay it.
      return state.hasSalvage ? { type: 'return_salvaged' } : stop('OUTPUT_TRUNCATED');

    case 'SCHEMA_ERROR':
      if (state.useSchema && state.allowSchemaDegradation) return { type: 'degrade_schema' };
      return moveOn();

    case 'MODEL_UNAVAILABLE':
      return moveOn();

    case 'RATE_LIMIT': {
      // Another model has its own quota: prefer hopping over hammering the limited one.
      if (state.hasNextModel) {
        const hint = state.retryAfterMs;
        const cap = state.maxRateLimitWaitMs ?? 10_000;
        if (state.used.rateLimit < 1 && hint !== undefined && hint <= cap) {
          return retry(Math.max(hint, state.backoffMs));
        }
        return moveOn();
      }
      // Last model standing: waiting is the only option.
      if (state.used.rateLimit < state.maxRetries) {
        const wait = Math.max(state.retryAfterMs ?? 0, state.backoffMs);
        return canStartAfter(wait) ? { type: 'retry_same', waitMs: wait } : noBudget();
      }
      return stop('RATE_LIMIT');
    }

    case 'TIMEOUT':
      // Retrying a timeout with the same limit almost always times out again, so the
      // default is to move to the next model — and only if there is budget for it.
      if (state.retryOnTimeout && state.used.transient < state.maxRetries) return retry(state.backoffMs);
      return state.hasNextModel ? moveOn() : stop('TIMEOUT');

    case 'TRANSIENT_PROVIDER_ERROR':
      if (state.used.transient < state.maxRetries) return retry(state.backoffMs);
      return state.hasNextModel ? moveOn() : stop('TRANSIENT_PROVIDER_ERROR');

    case 'INVALID_JSON':
    case 'VALIDATION_ERROR':
      // Sampling is non-deterministic, so ONE resample can succeed; more is a storm.
      if (state.used.badResponse < Math.min(state.maxRetries, state.maxBadResponseRetries)) return retry(state.backoffMs);
      return state.hasNextModel ? moveOn() : stop(state.failure);

    case 'UNKNOWN':
    default:
      // Could be model-specific, so confirm on ONE other model; a deterministic bad
      // request must not be replayed against the whole chain.
      if (state.hasNextModel && state.unknownHops < 1) return moveOn();
      return stop('UNKNOWN');
  }
}
