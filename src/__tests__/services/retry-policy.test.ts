/**
 * Retry ownership: every failure class has exactly ONE handling rule, and
 * deterministic failures are never replayed.
 */
import { describe, it, expect } from 'vitest';
import {
  GeminiBadResponseError,
  GeminiBudgetExhaustedError,
  GeminiTimeoutError,
  GeminiTruncatedResponseError,
  type FailureCode,
} from '@/services/ai/errors';
import { MAX_SPLIT_DEPTH, classifyFailure, decideNext, extractRetryAfterMs, isSplittableFailure, type PolicyState } from '@/services/ai/retry-policy';

function http(status: number, message = 'upstream') {
  return Object.assign(new Error(`[${status}] ${message}`), { status });
}

function state(over: Partial<PolicyState> & { failure: FailureCode }): PolicyState {
  return {
    used: { transient: 0, badResponse: 0, rateLimit: 0 },
    maxRetries: 2,
    maxBadResponseRetries: 1,
    useSchema: false,
    allowSchemaDegradation: true,
    thinkingRejected: false,
    retryOnTimeout: false,
    hasSalvage: false,
    hasNextModel: true,
    unknownHops: 0,
    remainingMs: null,
    minAttemptMs: 10_000,
    backoffMs: 1_000,
    ...over,
  };
}

describe('classifyFailure — the taxonomy', () => {
  it.each([
    [http(401), 'AUTH_ERROR'],
    [http(403), 'AUTH_ERROR'],
    [http(429, 'Too Many Requests'), 'RATE_LIMIT'],
    [http(503, 'Service Unavailable'), 'TRANSIENT_PROVIDER_ERROR'],
    [http(500), 'TRANSIENT_PROVIDER_ERROR'],
    [http(404, 'model not found'), 'MODEL_UNAVAILABLE'],
    [http(400, 'Invalid JSON payload received. Unknown name "propertyOrdering"'), 'SCHEMA_ERROR'],
    [http(413), 'REQUEST_TOO_LARGE'],
    [http(400, 'The input token count (1200000) exceeds the maximum number of tokens allowed (1048576)'), 'REQUEST_TOO_LARGE'],
    [http(400, 'something else entirely'), 'UNKNOWN'],
    [new GeminiTimeoutError(60_000, 'm'), 'TIMEOUT'],
    [Object.assign(new Error('aborted'), { name: 'AbortError' }), 'TIMEOUT'],
    [new GeminiBadResponseError('empty'), 'INVALID_JSON'],
    [new GeminiBadResponseError('schema', [{ path: ['x'], message: 'bad' }]), 'VALIDATION_ERROR'],
    [new GeminiTruncatedResponseError('cut', {}), 'OUTPUT_TRUNCATED'],
    [new GeminiBudgetExhaustedError(100, 10_000), 'SERVER_BUDGET_EXHAUSTED'],
    [new TypeError('x is not a function'), 'UNKNOWN'],
  ] as [unknown, FailureCode][])('%#', (error, expected) => {
    expect(classifyFailure(error)).toBe(expected);
  });

  it('a max_output_tokens CONFIG error is not mistaken for an oversized INPUT', () => {
    expect(classifyFailure(http(400, 'max_output_tokens exceeds the model limit'))).not.toBe('REQUEST_TOO_LARGE');
  });
});

describe('extractRetryAfterMs', () => {
  it('parses the provider hint in seconds and milliseconds, and ignores absence', () => {
    expect(extractRetryAfterMs(new Error('Please retry in 12.5s.'))).toBe(12_500);
    expect(extractRetryAfterMs(new Error('{"retryDelay":"7s"}'))).toBe(7_000);
    expect(extractRetryAfterMs(new Error('retry in 800ms'))).toBe(800);
    expect(extractRetryAfterMs(new Error('boom'))).toBeUndefined();
  });
});

describe('decideNext — one rule per failure class', () => {
  it('AUTH_ERROR / REQUEST_TOO_LARGE / SERVER_BUDGET_EXHAUSTED stop immediately (never fan out to other models)', () => {
    for (const failure of ['AUTH_ERROR', 'REQUEST_TOO_LARGE', 'SERVER_BUDGET_EXHAUSTED'] as FailureCode[]) {
      expect(decideNext(state({ failure }))).toEqual({ type: 'stop', reason: failure });
    }
  });

  it('OUTPUT_TRUNCATED never replays the request: salvage if valid, else stop', () => {
    expect(decideNext(state({ failure: 'OUTPUT_TRUNCATED', hasSalvage: true }))).toEqual({ type: 'return_salvaged' });
    expect(decideNext(state({ failure: 'OUTPUT_TRUNCATED' }))).toEqual({ type: 'stop', reason: 'OUTPUT_TRUNCATED' });
  });

  it('TIMEOUT moves to the next model by default; same-model retry only on explicit opt-in', () => {
    expect(decideNext(state({ failure: 'TIMEOUT' }))).toEqual({ type: 'next_model' });
    expect(decideNext(state({ failure: 'TIMEOUT', retryOnTimeout: true }))).toEqual({ type: 'retry_same', waitMs: 1_000 });
  });

  it('TRANSIENT retries the same model with backoff up to maxRetries, then moves on', () => {
    expect(decideNext(state({ failure: 'TRANSIENT_PROVIDER_ERROR' }))).toEqual({ type: 'retry_same', waitMs: 1_000 });
    expect(decideNext(state({ failure: 'TRANSIENT_PROVIDER_ERROR', used: { transient: 2, badResponse: 0, rateLimit: 0 } }))).toEqual({ type: 'next_model' });
  });

  it('RATE_LIMIT prefers another model (own quota); at most ONE short server-hinted wait on the same model', () => {
    expect(decideNext(state({ failure: 'RATE_LIMIT' }))).toEqual({ type: 'next_model' });
    expect(decideNext(state({ failure: 'RATE_LIMIT', retryAfterMs: 3_000 }))).toEqual({ type: 'retry_same', waitMs: 3_000 });
    // already waited once -> hop
    expect(decideNext(state({ failure: 'RATE_LIMIT', retryAfterMs: 3_000, used: { transient: 0, badResponse: 0, rateLimit: 1 } }))).toEqual({ type: 'next_model' });
    // a hint longer than we are willing to wait -> hop instead of sleeping
    expect(decideNext(state({ failure: 'RATE_LIMIT', retryAfterMs: 60_000 }))).toEqual({ type: 'next_model' });
  });

  it('RATE_LIMIT on the LAST model waits (bounded by maxRetries) because there is nowhere else to go', () => {
    expect(decideNext(state({ failure: 'RATE_LIMIT', hasNextModel: false }))).toEqual({ type: 'retry_same', waitMs: 1_000 });
    expect(decideNext(state({ failure: 'RATE_LIMIT', hasNextModel: false, used: { transient: 0, badResponse: 0, rateLimit: 2 } }))).toEqual({ type: 'stop', reason: 'RATE_LIMIT' });
  });

  it('INVALID_JSON / VALIDATION_ERROR get exactly ONE resample, regardless of maxRetries', () => {
    for (const failure of ['INVALID_JSON', 'VALIDATION_ERROR'] as FailureCode[]) {
      expect(decideNext(state({ failure, maxRetries: 5 }))).toEqual({ type: 'retry_same', waitMs: 1_000 });
      expect(decideNext(state({ failure, maxRetries: 5, used: { transient: 0, badResponse: 1, rateLimit: 0 } }))).toEqual({ type: 'next_model' });
    }
  });

  it('SCHEMA_ERROR degrades the schema once, then moves on', () => {
    expect(decideNext(state({ failure: 'SCHEMA_ERROR', useSchema: true }))).toEqual({ type: 'degrade_schema' });
    expect(decideNext(state({ failure: 'SCHEMA_ERROR', useSchema: false }))).toEqual({ type: 'next_model' });
  });

  it('UNKNOWN is confirmed on at most ONE other model, then stops (a bad request is not replayed across the chain)', () => {
    expect(decideNext(state({ failure: 'UNKNOWN' }))).toEqual({ type: 'next_model' });
    expect(decideNext(state({ failure: 'UNKNOWN', unknownHops: 1 }))).toEqual({ type: 'stop', reason: 'UNKNOWN' });
  });

  it('a bare 400 (UNKNOWN) drops thinking first, then the schema, on the SAME model, before hopping or stopping', () => {
    const bare = { failure: 'UNKNOWN' as FailureCode, status: 400, useThinking: true, useSchema: true };
    expect(decideNext(state(bare))).toEqual({ type: 'degrade_thinking' });
    expect(decideNext(state({ ...bare, useThinking: false }))).toEqual({ type: 'degrade_schema' });
    // nothing optional left to drop -> the old rule: confirm on one other model, then stop
    expect(decideNext(state({ ...bare, useThinking: false, useSchema: false }))).toEqual({ type: 'next_model' });
    expect(decideNext(state({ ...bare, useThinking: false, useSchema: false, hasNextModel: false }))).toEqual({ type: 'stop', reason: 'UNKNOWN' });
    // schema degradation can be disallowed by the caller
    expect(decideNext(state({ ...bare, useThinking: false, allowSchemaDegradation: false, hasNextModel: false }))).toEqual({ type: 'stop', reason: 'UNKNOWN' });
  });

  it('the 400 degradation does not apply to other statuses or other failure classes', () => {
    expect(decideNext(state({ failure: 'UNKNOWN', status: 500, useThinking: true, useSchema: true, hasNextModel: false }))).toEqual({ type: 'stop', reason: 'UNKNOWN' });
    expect(decideNext(state({ failure: 'REQUEST_TOO_LARGE', status: 400, useThinking: true, useSchema: true }))).toEqual({ type: 'stop', reason: 'REQUEST_TOO_LARGE' });
    expect(decideNext(state({ failure: 'AUTH_ERROR', status: 400, useThinking: true }))).toEqual({ type: 'stop', reason: 'AUTH_ERROR' });
  });

  it('with no next model, failures that would hop simply stop with their own reason', () => {
    expect(decideNext(state({ failure: 'MODEL_UNAVAILABLE', hasNextModel: false }))).toEqual({ type: 'stop', reason: 'MODEL_UNAVAILABLE' });
    expect(decideNext(state({ failure: 'TIMEOUT', hasNextModel: false }))).toEqual({ type: 'stop', reason: 'TIMEOUT' });
  });
});

describe('decideNext — remaining-budget awareness', () => {
  it('does not start a doomed attempt: not enough budget for retry/hop -> SERVER_BUDGET_EXHAUSTED', () => {
    expect(decideNext(state({ failure: 'TRANSIENT_PROVIDER_ERROR', remainingMs: 5_000 }))).toEqual({ type: 'stop', reason: 'SERVER_BUDGET_EXHAUSTED' });
    expect(decideNext(state({ failure: 'TIMEOUT', remainingMs: 5_000 }))).toEqual({ type: 'stop', reason: 'SERVER_BUDGET_EXHAUSTED' });
  });

  it('counts the backoff wait against the budget (wait + minimum attempt must fit)', () => {
    // 10.5s left: a retry needs 1s wait + 10s attempt = 11s -> cannot; hop (needs only 10s) can.
    expect(decideNext(state({ failure: 'TRANSIENT_PROVIDER_ERROR', remainingMs: 10_500 }))).toEqual({ type: 'next_model' });
    expect(decideNext(state({ failure: 'TRANSIENT_PROVIDER_ERROR', remainingMs: 12_000 }))).toEqual({ type: 'retry_same', waitMs: 1_000 });
  });

  it('a valid truncated salvage is returned rather than discarded when budget runs out', () => {
    expect(decideNext(state({ failure: 'TRANSIENT_PROVIDER_ERROR', remainingMs: 1_000, hasSalvage: true }))).toEqual({ type: 'return_salvaged' });
  });

  it('null remaining budget means unconstrained (callers without a budget behave as before)', () => {
    expect(decideNext(state({ failure: 'TRANSIENT_PROVIDER_ERROR', remainingMs: null }))).toEqual({ type: 'retry_same', waitMs: 1_000 });
  });
});

describe('which failures workflows may answer by SPLITTING the work', () => {
  it('only size/length-related failures are splittable — never auth, rate limit, budget, or transient outages', () => {
    for (const f of ['OUTPUT_TRUNCATED', 'REQUEST_TOO_LARGE', 'TIMEOUT', 'INVALID_JSON', 'VALIDATION_ERROR'] as FailureCode[]) {
      expect(isSplittableFailure(f)).toBe(true);
    }
    for (const f of ['AUTH_ERROR', 'RATE_LIMIT', 'TRANSIENT_PROVIDER_ERROR', 'MODEL_UNAVAILABLE', 'SCHEMA_ERROR', 'SERVER_BUDGET_EXHAUSTED', 'NO_PROGRESS', 'UNKNOWN'] as FailureCode[]) {
      expect(isSplittableFailure(f)).toBe(false);
    }
    expect(isSplittableFailure(undefined)).toBe(false);
  });

  it('a unit of work is split at most once (shared by Generate and repair)', () => {
    expect(MAX_SPLIT_DEPTH).toBe(1);
  });
});

describe('safeErrorDetail — the provider message is loggable, credentials are not', () => {
  it('keeps the provider explanation, collapses whitespace and caps the length', async () => {
    const { safeErrorDetail } = await import('@/services/ai/errors');
    expect(safeErrorDetail(new Error('[400]  Request contains\n an invalid   argument.'))).toBe('[400] Request contains an invalid argument.');
    const long = safeErrorDetail(new Error('x'.repeat(2_000)), 100);
    expect(long.length).toBe(100);
    expect(long.endsWith('…')).toBe(true);
    expect(safeErrorDetail(undefined)).toBe('');
    expect(safeErrorDetail({ message: 'plain object' })).toBe('plain object');
  });

  it('redacts API keys, key= query params and bearer tokens', async () => {
    const { safeErrorDetail, describeErrorForLog } = await import('@/services/ai/errors');
    const fakeKey = `AIza${'a'.repeat(35)}`;
    const err = Object.assign(new Error(`[400] bad https://x/y?key=${fakeKey}&alt=json Authorization: Bearer abcdefghijklmnop1234 ${fakeKey}`), { status: 400 });
    const detail = safeErrorDetail(err);
    expect(detail).not.toContain(fakeKey);
    expect(detail).not.toContain('abcdefghijklmnop1234');
    expect(detail).toContain('[redacted');
    expect(describeErrorForLog(err)).not.toContain(fakeKey);
    expect(describeErrorForLog(err)).toMatch(/^fatal\/400 \(Error\): /);
  });
});
